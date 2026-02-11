<?php
/**
 * ASIN Scout Pro - Error Logs API
 * Extension ve website'den gelen hataları kaydeder ve admin için listeler
 */

require_once __DIR__ . '/../includes/bootstrap.php';

$action = $_GET['action'] ?? '';

try {
    $db = Database::getInstance();
} catch (Exception $e) {
    die(json_encode(['error' => 'Database error']));
}

switch ($action) {

    // ================== PUBLIC: Hata Kaydet ==================
    case 'report':
        // CORS headers for extension
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(200);
            exit;
        }

        $data = Api::getPostData();

        // Minimum gerekli alan
        if (empty($data['error_message']) || empty($data['source'])) {
            Api::error('error_message and source are required', 400);
        }

        // Token varsa kullanici bilgisi al
        $userId = null;
        $userEmail = null;
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
            try {
                $decoded = Auth::verifyToken($matches[1]);
                if ($decoded) {
                    $userId = $decoded['user_id'] ?? null;
                    $user = $db->fetch("SELECT email FROM users WHERE id = ?", [$userId]);
                    $userEmail = $user ? $user['email'] : null;
                }
            } catch (Exception $e) {
                // Token gecersiz, devam et
            }
        }

        // Kullanici email'i data'dan da gelebilir
        if (!$userEmail && !empty($data['user_email'])) {
            $userEmail = substr($data['user_email'], 0, 255);
        }

        $logData = [
            'user_id' => $userId,
            'user_email' => $userEmail,
            'error_type' => substr($data['error_type'] ?? 'unknown', 0, 50),
            'error_message' => substr($data['error_message'], 0, 65000),
            'error_stack' => isset($data['error_stack']) ? substr($data['error_stack'], 0, 65000) : null,
            'source' => substr($data['source'], 0, 50),
            'url' => isset($data['url']) ? substr($data['url'], 0, 2000) : null,
            'browser_info' => isset($data['browser_info']) ? substr($data['browser_info'], 0, 255) : null,
            'extension_version' => isset($data['extension_version']) ? substr($data['extension_version'], 0, 20) : null,
            'extra_data' => isset($data['extra_data']) ? json_encode($data['extra_data']) : null,
            'ip_address' => $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? null
        ];

        $db->insert('error_logs', $logData);

        Api::success(null, 'Error logged');
        break;

    // ================== ADMIN: Hatalari Listele ==================
    case 'list':
        $admin = Auth::requireAdmin();

        $page = max(1, (int)($_GET['page'] ?? 1));
        $limit = 50;
        $offset = ($page - 1) * $limit;

        // Filtreler
        $where = "WHERE 1=1";
        $params = [];

        if (!empty($_GET['error_type'])) {
            $where .= " AND error_type = ?";
            $params[] = $_GET['error_type'];
        }

        if (!empty($_GET['source'])) {
            $where .= " AND source = ?";
            $params[] = $_GET['source'];
        }

        if (!empty($_GET['resolved'])) {
            $where .= " AND is_resolved = ?";
            $params[] = $_GET['resolved'] === 'yes' ? 1 : 0;
        }

        if (!empty($_GET['search'])) {
            $where .= " AND (error_message LIKE ? OR user_email LIKE ? OR url LIKE ?)";
            $search = "%" . $_GET['search'] . "%";
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }

        if (!empty($_GET['date_from'])) {
            $where .= " AND DATE(created_at) >= ?";
            $params[] = $_GET['date_from'];
        }

        if (!empty($_GET['date_to'])) {
            $where .= " AND DATE(created_at) <= ?";
            $params[] = $_GET['date_to'];
        }

        // Toplam sayı
        $row = $db->fetch("SELECT COUNT(*) as cnt FROM error_logs $where", $params);
        $total = $row ? (int)$row['cnt'] : 0;

        // Logları getir
        $logs = $db->fetchAll(
            "SELECT * FROM error_logs $where ORDER BY created_at DESC LIMIT $limit OFFSET $offset",
            $params
        ) ?: [];

        Api::success([
            'logs' => $logs,
            'total' => $total,
            'page' => $page,
            'pages' => max(1, ceil($total / $limit))
        ]);
        break;

    // ================== ADMIN: Istatistikler ==================
    case 'stats':
        $admin = Auth::requireAdmin();

        $stats = [];

        // Toplam hata sayısı
        $row = $db->fetch("SELECT COUNT(*) as cnt FROM error_logs");
        $stats['total_errors'] = $row ? (int)$row['cnt'] : 0;

        // Bugun
        $row = $db->fetch("SELECT COUNT(*) as cnt FROM error_logs WHERE DATE(created_at) = CURDATE()");
        $stats['today_errors'] = $row ? (int)$row['cnt'] : 0;

        // Cozulmemis
        $row = $db->fetch("SELECT COUNT(*) as cnt FROM error_logs WHERE is_resolved = 0");
        $stats['unresolved_errors'] = $row ? (int)$row['cnt'] : 0;

        // Tip bazinda
        $stats['by_type'] = $db->fetchAll(
            "SELECT error_type, COUNT(*) as count FROM error_logs GROUP BY error_type ORDER BY count DESC"
        ) ?: [];

        // Kaynak bazinda
        $stats['by_source'] = $db->fetchAll(
            "SELECT source, COUNT(*) as count FROM error_logs GROUP BY source ORDER BY count DESC"
        ) ?: [];

        // Son 7 gun
        $stats['last_7_days'] = $db->fetchAll(
            "SELECT DATE(created_at) as date, COUNT(*) as count
             FROM error_logs
             WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
             GROUP BY DATE(created_at) ORDER BY date"
        ) ?: [];

        // En sık hatalar (son 7 gün)
        $stats['top_errors'] = $db->fetchAll(
            "SELECT error_message, error_type, source, COUNT(*) as count
             FROM error_logs
             WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
             GROUP BY error_message, error_type, source
             ORDER BY count DESC LIMIT 10"
        ) ?: [];

        Api::success($stats);
        break;

    // ================== ADMIN: Tek Log Detay ==================
    case 'detail':
        $admin = Auth::requireAdmin();

        $id = (int)($_GET['id'] ?? 0);
        if (!$id) {
            Api::error('Log ID required', 400);
        }

        $log = $db->fetch("SELECT * FROM error_logs WHERE id = ?", [$id]);
        if (!$log) {
            Api::error('Log not found', 404);
        }

        // Extra data'yi decode et
        if ($log['extra_data']) {
            $log['extra_data'] = json_decode($log['extra_data'], true);
        }

        Api::success(['log' => $log]);
        break;

    // ================== ADMIN: Durumu Guncelle ==================
    case 'update':
        $admin = Auth::requireAdmin();

        $data = Api::getPostData();
        Api::required($data, ['id']);

        $id = (int)$data['id'];
        $updates = [];

        if (isset($data['is_resolved'])) {
            $updates['is_resolved'] = (int)$data['is_resolved'];
            if ($data['is_resolved']) {
                $updates['resolved_at'] = date('Y-m-d H:i:s');
                $updates['resolved_by'] = $admin['id'];
            } else {
                $updates['resolved_at'] = null;
                $updates['resolved_by'] = null;
            }
        }

        if (isset($data['notes'])) {
            $updates['notes'] = $data['notes'];
        }

        if (!empty($updates)) {
            $db->update('error_logs', $updates, 'id = :id', ['id' => $id]);
        }

        Api::success(null, 'Log updated');
        break;

    // ================== ADMIN: Toplu Sil ==================
    case 'delete':
        $admin = Auth::requireAdmin();

        $data = Api::getPostData();

        if (!empty($data['ids']) && is_array($data['ids'])) {
            // Belirli ID'leri sil
            $ids = array_map('intval', $data['ids']);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $db->query("DELETE FROM error_logs WHERE id IN ($placeholders)", $ids);
            Api::success(null, count($ids) . ' logs deleted');
        } elseif (!empty($data['older_than_days'])) {
            // X günden eski olanları sil
            $days = (int)$data['older_than_days'];
            $db->query("DELETE FROM error_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)", [$days]);
            Api::success(null, 'Old logs deleted');
        } elseif (!empty($data['resolved_only'])) {
            // Sadece çözülmüş olanları sil
            $db->query("DELETE FROM error_logs WHERE is_resolved = 1");
            Api::success(null, 'Resolved logs deleted');
        } else {
            Api::error('Specify ids, older_than_days, or resolved_only', 400);
        }
        break;

    default:
        Api::error('Invalid action', 400);
}
