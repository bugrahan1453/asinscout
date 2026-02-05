<?php
/**
 * ASIN Scout Pro - Admin API v2
 */

require_once __DIR__ . '/../includes/bootstrap.php';

$action = $_GET['action'] ?? '';
$db = Database::getInstance();
$admin = Auth::requireAdmin();

switch ($action) {
    
    case 'dashboard':
        $stats = [];
        
        $stats['total_users'] = (int)$db->fetch("SELECT COUNT(*) as cnt FROM users WHERE role = 'user'")['cnt'];
        $stats['today_users'] = (int)$db->fetch("SELECT COUNT(*) as cnt FROM users WHERE DATE(created_at) = CURDATE()")['cnt'];
        $stats['active_packages'] = (int)$db->fetch("SELECT COUNT(*) as cnt FROM users WHERE package_expires > NOW()")['cnt'];
        $stats['total_scans'] = (int)$db->fetch("SELECT COUNT(*) as cnt FROM scans")['cnt'];
        $stats['total_asins'] = (int)$db->fetch("SELECT COALESCE(SUM(asin_count), 0) as cnt FROM scans")['cnt'];
        $stats['total_revenue'] = (float)$db->fetch("SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status = 'completed'")['total'];
        $stats['month_revenue'] = (float)$db->fetch("SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status = 'completed' AND MONTH(completed_at) = MONTH(CURDATE())")['total'];
        
        $stats['week_scans'] = $db->fetchAll(
            "SELECT DATE(created_at) as date, COUNT(*) as count, SUM(asin_count) as asins 
             FROM scans WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
             GROUP BY DATE(created_at) ORDER BY date"
        );
        
        $stats['recent_orders'] = $db->fetchAll(
            "SELECT o.*, u.email, u.name, p.name as package_name 
             FROM orders o 
             JOIN users u ON o.user_id = u.id 
             JOIN packages p ON o.package_id = p.id 
             WHERE o.status = 'completed'
             ORDER BY o.completed_at DESC LIMIT 10"
        );
        
        Api::success($stats);
        break;
    
    case 'users':
        $page = max(1, (int)($_GET['page'] ?? 1));
        $limit = 50;
        $offset = ($page - 1) * $limit;
        $search = $_GET['search'] ?? '';
        
        $where = "WHERE role = 'user'";
        $params = [];
        
        if ($search) {
            $where .= " AND (email LIKE ? OR name LIKE ?)";
            $params[] = "%$search%";
            $params[] = "%$search%";
        }
        
        $total = $db->fetch("SELECT COUNT(*) as cnt FROM users $where", $params)['cnt'];
        
        $params[] = $limit;
        $params[] = $offset;
        $users = $db->fetchAll(
            "SELECT u.id, u.email, u.name, u.scan_limit, u.daily_scan_limit, u.daily_scans_used, u.package_expires, u.total_scans, u.total_asins,
                    u.status, u.created_at, u.last_login, p.name as package_name
             FROM users u
             LEFT JOIN packages p ON u.package_id = p.id
             $where ORDER BY u.created_at DESC LIMIT ? OFFSET ?",
            $params
        );
        
        Api::success([
            'users' => $users,
            'total' => (int)$total,
            'page' => $page,
            'pages' => ceil($total / $limit)
        ]);
        break;
    
    case 'user_update':
        $data = Api::getPostData();
        Api::required($data, ['user_id']);
        
        $userId = (int)$data['user_id'];
        $updates = [];
        
        if (isset($data['name'])) $updates['name'] = trim($data['name']);
        if (isset($data['status'])) $updates['status'] = in_array($data['status'], ['active', 'suspended']) ? $data['status'] : 'active';
        if (isset($data['scan_limit'])) $updates['scan_limit'] = max(0, (int)$data['scan_limit']);
        if (isset($data['package_id'])) {
            $updates['package_id'] = (int)$data['package_id'] ?: null;
            if ($updates['package_id']) {
                $pkg = $db->fetch("SELECT scan_limit, duration_days FROM packages WHERE id = ?", [$updates['package_id']]);
                if ($pkg) {
                    $updates['scan_limit'] = $pkg['scan_limit'];
                    $updates['package_expires'] = date('Y-m-d H:i:s', strtotime('+' . $pkg['duration_days'] . ' days'));
                }
            }
        }
        
        if (!empty($updates)) {
            $db->update('users', $updates, 'id = :id', ['id' => $userId]);
        }
        
        Api::success(null, 'User updated');
        break;
    
    case 'assign_package':
        try {
            $data = Api::getPostData();
            Api::required($data, ['user_id']);
            
            $userId = (int)$data['user_id'];
            
            if (isset($data['package_id']) && $data['package_id']) {
                // Paket ata
                $pkg = $db->fetch("SELECT * FROM packages WHERE id = ?", [$data['package_id']]);
                if (!$pkg) {
                    Api::error('Package not found');
                }
                
                $expiresAt = date('Y-m-d H:i:s', strtotime('+' . $pkg['duration_days'] . ' days'));
                
                $db->query(
                    "UPDATE users SET package_id = ?, scan_limit = ?, daily_scan_limit = ?, daily_scans_used = 0, package_expires = ? WHERE id = ?",
                    [$pkg['id'], $pkg['scan_limit'], $pkg['daily_scan_limit'] ?? 0, $expiresAt, $userId]
                );
            } elseif (isset($data['scan_limit']) && $data['scan_limit']) {
                // Custom limit ata
                $scanLimit = (int)$data['scan_limit'];
                $expiresAt = date('Y-m-d H:i:s', strtotime('+30 days'));
                
                $db->query(
                    "UPDATE users SET package_id = NULL, scan_limit = ?, package_expires = ? WHERE id = ?",
                    [$scanLimit, $expiresAt, $userId]
                );
            } else {
                Api::error('Package ID or scan limit required');
            }
            
            Api::success(null, 'Package assigned successfully');
        } catch (Exception $e) {
            Api::error('Error: ' . $e->getMessage());
        }
        break;
    
    case 'packages':
        $packages = $db->fetchAll("SELECT * FROM packages ORDER BY sort_order");
        foreach ($packages as &$pkg) {
            $pkg['features'] = json_decode($pkg['features'], true) ?: [];
        }
        Api::success(['packages' => $packages]);
        break;
    
    case 'package_save':
        try {
            $data = Api::getPostData();
            Api::required($data, ['name', 'scan_limit', 'price']);
            
            $packageData = [
                'name' => $data['name'],
                'slug' => $data['slug'] ?? strtolower(preg_replace('/[^a-z0-9]+/', '-', $data['name'])),
                'scan_limit' => (int)$data['scan_limit'],
                'daily_scan_limit' => (int)($data['daily_scan_limit'] ?? 0),
                'duration_days' => (int)($data['duration_days'] ?? 30),
                'price' => (float)$data['price'],
                'currency' => $data['currency'] ?? 'USD',
                'description' => $data['description'] ?? '',
                'features' => json_encode($data['features'] ?? []),
                'is_popular' => (int)($data['is_popular'] ?? 0),
                'is_active' => (int)($data['is_active'] ?? 1),
                'sort_order' => (int)($data['sort_order'] ?? 0)
            ];
            
            if (isset($data['id']) && $data['id']) {
                $db->update('packages', $packageData, 'id = :id', ['id' => (int)$data['id']]);
            } else {
                $db->insert('packages', $packageData);
            }
            
            Api::success(null, 'Package saved');
        } catch (Exception $e) {
            Api::error('Database error: ' . $e->getMessage());
        }
        break;
    
    case 'orders':
        $page = max(1, (int)($_GET['page'] ?? 1));
        $limit = 50;
        $offset = ($page - 1) * $limit;
        
        $total = $db->fetch("SELECT COUNT(*) as cnt FROM orders")['cnt'];
        
        $orders = $db->fetchAll(
            "SELECT o.*, u.email, u.name, p.name as package_name, p.scan_limit
             FROM orders o
             JOIN users u ON o.user_id = u.id
             JOIN packages p ON o.package_id = p.id
             ORDER BY o.created_at DESC LIMIT ? OFFSET ?",
            [$limit, $offset]
        );
        
        Api::success([
            'orders' => $orders,
            'total' => (int)$total,
            'page' => $page,
            'pages' => ceil($total / $limit)
        ]);
        break;
    
    case 'settings':
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $data = Api::getPostData();
            foreach ($data as $key => $value) {
                $db->query("INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) 
                           ON DUPLICATE KEY UPDATE setting_value = ?", [$key, $value, $value]);
            }
            Api::success(null, 'Settings updated');
        } else {
            $settings = $db->fetchAll("SELECT * FROM settings");
            $result = [];
            foreach ($settings as $s) {
                $result[$s['setting_key']] = ['value' => $s['setting_value'], 'type' => $s['setting_type']];
            }
            Api::success(['settings' => $result]);
        }
        break;
    
    default:
        Api::error('Invalid action', 400);
}
