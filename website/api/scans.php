<?php
/**
 * ASIN Scout Pro - Scans API v2
 * Paket limiti bazlı (kredi yok)
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

try {
    require_once __DIR__ . '/../includes/bootstrap.php';
} catch (Exception $e) {
    die(json_encode(['error' => 'Bootstrap error: ' . $e->getMessage()]));
}

$action = $_GET['action'] ?? '';

try {
    $db = Database::getInstance();
} catch (Exception $e) {
    die(json_encode(['error' => 'Database error: ' . $e->getMessage()]));
}

// Token kontrolü - download hariç
try {
    if ($action !== 'download') {
        $user = Auth::requireAuth();
    } else {
        // Download için token query'den al
        $token = $_GET['token'] ?? '';
        if (!$token) {
            Api::error('Token required', 401);
        }
        $payload = Auth::verifyToken($token);
        if (!$payload) {
            Api::error('Invalid token', 401);
        }
        $user = $db->fetch("SELECT * FROM users WHERE id = ?", [$payload['user_id']]);
    }
} catch (Exception $e) {
    die(json_encode(['error' => 'Auth error: ' . $e->getMessage()]));
}

try {
switch ($action) {
    
    case 'start':
        Api::rateLimit('scan_' . $user['id'], 30, 60); // max 30 scan start per minute
        $data = Api::getPostData();
        Api::required($data, ['store_url']);

        $today = date('Y-m-d');

        // Kullanıcının hangi paketten kullanmak istediği
        $selectedPackageId = isset($data['user_package_id']) ? (int)$data['user_package_id'] : null;
        $userPackage = null;
        $scanLimit = 999999;
        $dailyLimit = 0;
        $dailyUsed = 0;

        // Çoklu paket sistemi - kullanıcı paket seçtiyse
        if ($selectedPackageId) {
            $userPackage = $db->fetch(
                "SELECT * FROM user_packages
                 WHERE id = ? AND user_id = ? AND is_active = 1 AND expires_at > NOW()",
                [$selectedPackageId, $user['id']]
            );

            if (!$userPackage) {
                Api::error('Seçilen paket bulunamadı veya süresi dolmuş.', 404);
            }

            $scanLimit = (int)$userPackage['scan_limit'];
            $dailyLimit = (int)$userPackage['daily_scan_limit'];

            // Bu paketin günlük kullanımını kontrol et
            $lastScanDate = $userPackage['last_scan_date'] ?? null;
            $dailyUsed = ($lastScanDate === $today) ? (int)$userPackage['daily_scans_used'] : 0;

            // Günlük limit kontrolü (0 = sınırsız)
            $fullUser = $db->fetch("SELECT role FROM users WHERE id = ?", [$user['id']]);
            if ($dailyLimit > 0 && $dailyUsed >= $dailyLimit && $fullUser['role'] !== 'admin') {
                Api::error('Bu paketteki günlük tarama limitine ulaştınız (' . $dailyLimit . '/' . $dailyLimit . '). Yarın tekrar deneyin veya başka bir paket kullanın.', 429);
            }

        } else {
            // Eski sistem - geriye uyumluluk için
            // Aktif paketleri kontrol et (süresi dolmamış olanlar)
            $userPackages = $db->fetchAll(
                "SELECT * FROM user_packages
                 WHERE user_id = ? AND is_active = 1 AND expires_at > NOW()
                 ORDER BY expires_at ASC",
                [$user['id']]
            );

            // Günlük hakkı olan paketleri filtrele
            $availablePackages = [];
            if ($userPackages) {
                foreach ($userPackages as $pkg) {
                    $pkgDailyLimit = (int)$pkg['daily_scan_limit'];
                    $pkgLastScanDate = $pkg['last_scan_date'] ?? null;
                    $pkgDailyUsed = ($pkgLastScanDate === $today) ? (int)$pkg['daily_scans_used'] : 0;

                    // Günlük hakkı kalan paketler (0 = sınırsız demek)
                    if ($pkgDailyLimit === 0 || $pkgDailyUsed < $pkgDailyLimit) {
                        $pkg['_daily_used'] = $pkgDailyUsed;
                        $pkg['_daily_remaining'] = $pkgDailyLimit > 0 ? ($pkgDailyLimit - $pkgDailyUsed) : -1;
                        $availablePackages[] = $pkg;
                    }
                }
            }

            if (count($availablePackages) > 0) {
                // Birden fazla kullanılabilir paket varsa hata ver - seçim yapması lazım
                if (count($availablePackages) > 1) {
                    Api::error('Birden fazla aktif paketiniz var. Lütfen tarama için kullanmak istediğiniz paketi seçin.', 400, [
                        'multiple_packages' => true,
                        'packages' => array_map(function($p) {
                            return [
                                'id' => (int)$p['id'],
                                'package_name' => $p['package_name'],
                                'scan_limit' => (int)$p['scan_limit'],
                                'daily_scan_limit' => (int)$p['daily_scan_limit'],
                                'daily_remaining' => $p['_daily_remaining'],
                                'expires_at' => $p['expires_at']
                            ];
                        }, $availablePackages)
                    ]);
                }
                // Tek paket varsa onu kullan
                $userPackage = $availablePackages[0];
                $scanLimit = (int)$userPackage['scan_limit'];
                $dailyLimit = (int)$userPackage['daily_scan_limit'];
                $dailyUsed = $userPackage['_daily_used'];
            } else {
                // user_packages'da paket yok veya hepsinin günlük hakkı dolmuş
                // Eski sistemden kontrol et
                $fullUser = $db->fetch(
                    "SELECT u.*, p.scan_limit as pkg_limit, p.daily_scan_limit as pkg_daily_limit FROM users u
                     LEFT JOIN packages p ON u.package_id = p.id
                     WHERE u.id = ?",
                    [$user['id']]
                );

                $hasActivePackage = $fullUser['package_id'] && $fullUser['package_expires'] && strtotime($fullUser['package_expires']) > time();

                if (!$hasActivePackage && $fullUser['role'] !== 'admin') {
                    // user_packages var ama günlük hakkı dolmuş olabilir
                    if ($userPackages && count($userPackages) > 0) {
                        Api::error('Tüm paketlerinizin günlük tarama hakkı dolmuş. Yarın tekrar deneyin.', 429);
                    }
                    Api::error('Aktif paketiniz yok. Taramaya başlamak için lütfen bir paket satın alın.', 402);
                }

                $scanLimit = $hasActivePackage ? (int)$fullUser['scan_limit'] : 999999;
                $dailyLimit = (int)($fullUser['pkg_daily_limit'] ?? 0);

                // Eski sistem günlük kontrolü
                $dailyUsed = (int)($fullUser['daily_scans_used'] ?? 0);
                $lastScanDate = $fullUser['last_scan_date'] ?? null;
                if ($lastScanDate !== $today) {
                    $dailyUsed = 0;
                }

                if ($dailyLimit > 0 && $dailyUsed >= $dailyLimit && $fullUser['role'] !== 'admin') {
                    Api::error('Günlük tarama limitine ulaştınız (' . $dailyLimit . '/' . $dailyLimit . '). Yarın tekrar deneyin.', 429);
                }
            }
        }

        // Marketplace tespit
        preg_match('/amazon\.([a-z.]+)/i', $data['store_url'], $matches);
        $marketplace = 'amazon.' . ($matches[1] ?? 'com');

        $scanId = $db->insert('scans', [
            'user_id' => $user['id'],
            'user_package_id' => $userPackage ? $userPackage['id'] : null,
            'store_name' => $data['store_name'] ?? 'Unknown Store',
            'store_url' => $data['store_url'],
            'marketplace' => $marketplace,
            'status' => 'running'
        ]);

        // Günlük kullanımı artır
        if ($userPackage) {
            // Yeni sistem - user_packages'daki günlük sayacı güncelle
            $lastScanDate = $userPackage['last_scan_date'] ?? null;
            if ($lastScanDate !== $today) {
                // Gün değişti, sayacı sıfırla ve 1 yap
                $db->query(
                    "UPDATE user_packages SET daily_scans_used = 1, last_scan_date = ? WHERE id = ?",
                    [$today, $userPackage['id']]
                );
                $dailyUsed = 0; // Response için
            } else {
                $db->query(
                    "UPDATE user_packages SET daily_scans_used = daily_scans_used + 1 WHERE id = ?",
                    [$userPackage['id']]
                );
            }
        } else {
            // Eski sistem - users tablosundaki sayacı güncelle
            $db->query("UPDATE users SET daily_scans_used = daily_scans_used + 1, last_scan_date = ? WHERE id = ?", [$today, $user['id']]);
        }

        Api::log($user['id'], 'scan_start', [
            'scan_id' => $scanId,
            'user_package_id' => $userPackage ? $userPackage['id'] : null
        ]);

        Api::success([
            'scan_id' => $scanId,
            'scan_limit' => $scanLimit,
            'daily_remaining' => $dailyLimit > 0 ? max(0, $dailyLimit - $dailyUsed - 1) : -1,
            'user_package_id' => $userPackage ? (int)$userPackage['id'] : null,
            'package_name' => $userPackage ? $userPackage['package_name'] : null
        ], 'Tarama başlatıldı');
        break;
    
    case 'update':
        // Periyodik ara kayıt - tarama devam ederken ASIN'leri güncelle
        $data = Api::getPostData();
        Api::required($data, ['scan_id', 'asins']);

        $scan = $db->fetch(
            "SELECT id, user_id, status FROM scans WHERE id = ? AND user_id = ?",
            [$data['scan_id'], $user['id']]
        );

        if (!$scan) {
            Api::error('Scan not found', 404);
        }

        $asins = $data['asins'];
        if (is_string($asins)) {
            $asins = json_decode($asins, true) ?: explode("\n", $asins);
        }

        // Paket limitine göre kes
        $fullUser = $db->fetch("SELECT scan_limit, package_expires FROM users WHERE id = ?", [$user['id']]);
        $hasActivePackage = $fullUser['package_expires'] && strtotime($fullUser['package_expires']) > time();
        $limit = $hasActivePackage ? (int)$fullUser['scan_limit'] : 999999;

        if (count($asins) > $limit) {
            $asins = array_slice($asins, 0, $limit);
        }

        $asinCount = count($asins);

        // Taramayı güncelle (status running kalacak)
        $db->query(
            "UPDATE scans SET asin_count = ?, pages_scanned = ?, updated_at = NOW() WHERE id = ?",
            [$asinCount, $data['pages_scanned'] ?? 0, $data['scan_id']]
        );

        // Mevcut ASIN'leri sil ve yenilerini ekle
        $db->query("DELETE FROM scan_asins WHERE scan_id = ?", [$data['scan_id']]);

        if (!empty($asins)) {
            $values = [];
            $params = [];
            foreach ($asins as $asin) {
                $asin = trim($asin);
                if (preg_match('/^[A-Z0-9]{10}$/', $asin)) {
                    $values[] = "(?, ?)";
                    $params[] = $data['scan_id'];
                    $params[] = $asin;
                }
            }

            if (!empty($values)) {
                $chunks = array_chunk($values, 1000);
                $paramChunks = array_chunk($params, 2000);

                for ($i = 0; $i < count($chunks); $i++) {
                    $sql = "INSERT INTO scan_asins (scan_id, asin) VALUES " . implode(', ', $chunks[$i]);
                    $db->query($sql, $paramChunks[$i]);
                }
            }
        }

        Api::success([
            'scan_id' => $data['scan_id'],
            'asin_count' => $asinCount
        ], 'Scan updated');
        break;

    case 'complete':
        $data = Api::getPostData();
        Api::required($data, ['scan_id', 'asins']);
        
        $scan = $db->fetch(
            "SELECT id, user_id, status FROM scans WHERE id = ? AND user_id = ?",
            [$data['scan_id'], $user['id']]
        );
        
        if (!$scan) {
            Api::error('Scan not found', 404);
        }
        
        $asins = $data['asins'];
        if (is_string($asins)) {
            $asins = json_decode($asins, true) ?: explode("\n", $asins);
        }
        
        // Paket limitine göre kes
        $fullUser = $db->fetch("SELECT scan_limit, package_expires FROM users WHERE id = ?", [$user['id']]);
        $hasActivePackage = $fullUser['package_expires'] && strtotime($fullUser['package_expires']) > time();
        $limit = $hasActivePackage ? (int)$fullUser['scan_limit'] : 999999;
        
        if (count($asins) > $limit) {
            $asins = array_slice($asins, 0, $limit);
        }
        
        $asinCount = count($asins);
        $duration = isset($data['duration']) ? (int)$data['duration'] : 0;
        
        // Taramayı güncelle
        $db->query(
            "UPDATE scans SET status = 'completed', asin_count = ?, pages_scanned = ?, duration_seconds = ?, completed_at = NOW() WHERE id = ?",
            [$asinCount, $data['pages_scanned'] ?? 0, $duration, $data['scan_id']]
        );
        
        // User stats güncelle
        $db->query(
            "UPDATE users SET total_scans = total_scans + 1, total_asins = total_asins + ? WHERE id = ?",
            [$asinCount, $user['id']]
        );
        
        // ASIN'leri kaydet
        if (!empty($asins)) {
            $values = [];
            $params = [];
            foreach ($asins as $asin) {
                $asin = trim($asin);
                if (preg_match('/^[A-Z0-9]{10}$/', $asin)) {
                    $values[] = "(?, ?)";
                    $params[] = $data['scan_id'];
                    $params[] = $asin;
                }
            }
            
            if (!empty($values)) {
                $chunks = array_chunk($values, 1000);
                $paramChunks = array_chunk($params, 2000);
                
                for ($i = 0; $i < count($chunks); $i++) {
                    $sql = "INSERT INTO scan_asins (scan_id, asin) VALUES " . implode(', ', $chunks[$i]);
                    $db->query($sql, $paramChunks[$i]);
                }
            }
        }
        
        Api::log($user['id'], 'scan_complete', ['scan_id' => $data['scan_id'], 'asin_count' => $asinCount]);
        
        Api::success([
            'scan_id' => $data['scan_id'],
            'asin_count' => $asinCount,
            'limited' => count($data['asins']) > $limit
        ], 'Scan completed. ' . number_format($asinCount) . ' ASINs saved.');
        break;
    
    case 'list':
        $page = max(1, (int)($_GET['page'] ?? 1));
        $limit = min(50, max(10, (int)($_GET['limit'] ?? 20)));
        $offset = ($page - 1) * $limit;

        $row = $db->fetch("SELECT COUNT(*) as cnt FROM scans WHERE user_id = ?", [$user['id']]);
        $total = $row ? (int)$row['cnt'] : 0;

        $scans = $db->fetchAll(
            "SELECT id, store_name, store_url, marketplace, asin_count, pages_scanned,
                    duration_seconds, status, created_at, completed_at
             FROM scans WHERE user_id = ? ORDER BY created_at DESC LIMIT $limit OFFSET $offset",
            [$user['id']]
        ) ?: [];

        Api::success([
            'scans' => $scans,
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'pages' => max(1, ceil($total / $limit))
            ]
        ]);
        break;
    
    case 'detail':
        $scanId = (int)($_GET['id'] ?? 0);

        $scan = $db->fetch("SELECT * FROM scans WHERE id = ? AND user_id = ?", [$scanId, $user['id']]);

        if (!$scan) {
            Api::error('Scan not found', 404);
        }

        // ASIN'leri de getir (limit yok - tüm ASIN'ler)
        $asins = $db->fetchAll("SELECT asin FROM scan_asins WHERE scan_id = ?", [$scanId]) ?: [];
        $scan['asins'] = array_column($asins, 'asin');

        Api::success(['scan' => $scan]);
        break;
    
    case 'asins':
        $scanId = (int)($_GET['id'] ?? 0);

        $scan = $db->fetch("SELECT id, asin_count FROM scans WHERE id = ? AND user_id = ?", [$scanId, $user['id']]);
        if (!$scan) {
            Api::error('Scan not found', 404);
        }

        $asins = $db->fetchAll("SELECT asin FROM scan_asins WHERE scan_id = ?", [$scanId]) ?: [];

        Api::success([
            'asins' => array_column($asins, 'asin'),
            'total' => (int)$scan['asin_count']
        ]);
        break;
    
    case 'download':
        $scanId = (int)($_GET['id'] ?? 0);
        $format = $_GET['format'] ?? 'txt';

        $scan = $db->fetch("SELECT * FROM scans WHERE id = ? AND user_id = ?", [$scanId, $user['id']]);
        if (!$scan) {
            http_response_code(404);
            die('Scan not found');
        }

        $asins = $db->fetchAll("SELECT asin FROM scan_asins WHERE scan_id = ?", [$scanId]) ?: [];
        $asinList = array_column($asins, 'asin');
        
        $filename = preg_replace('/[^a-z0-9]/i', '_', $scan['store_name']) . '_' . count($asinList);
        
        // Marketplace'e göre doğru Amazon URL
        $mp = $scan['marketplace'] ?: 'amazon.com';
        $amazonBase = 'https://www.' . $mp . '/dp/';

        if ($format === 'csv') {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $filename . '.csv"');
            echo "ASIN,Amazon Link\n";
            foreach ($asinList as $asin) {
                echo $asin . ',' . $amazonBase . $asin . "\n";
            }
        } elseif ($format === 'excel' || $format === 'xlsx') {
            header('Content-Type: application/vnd.ms-excel');
            header('Content-Disposition: attachment; filename="' . $filename . '.xls"');
            echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
            echo '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' . "\n";
            echo '<Worksheet ss:Name="ASINs"><Table>' . "\n";
            echo '<Row><Cell><Data ss:Type="String">ASIN</Data></Cell><Cell><Data ss:Type="String">Amazon Link</Data></Cell></Row>' . "\n";
            foreach ($asinList as $asin) {
                echo '<Row><Cell><Data ss:Type="String">' . $asin . '</Data></Cell><Cell><Data ss:Type="String">' . $amazonBase . $asin . '</Data></Cell></Row>' . "\n";
            }
            echo '</Table></Worksheet></Workbook>';
        } else {
            header('Content-Type: text/plain; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $filename . '.txt"');
            echo implode("\n", $asinList);
        }
        exit;
        break;
    
    case 'delete':
        $scanId = (int)($_GET['id'] ?? 0);
        
        $scan = $db->fetch("SELECT id FROM scans WHERE id = ? AND user_id = ?", [$scanId, $user['id']]);
        if (!$scan) {
            Api::error('Scan not found', 404);
        }
        
        $db->query("DELETE FROM scan_asins WHERE scan_id = ?", [$scanId]);
        $db->query("DELETE FROM scans WHERE id = ?", [$scanId]);
        
        Api::success(null, 'Scan deleted');
        break;
    
    default:
        Api::error('Invalid action', 400);
}
} catch (Exception $e) {
    Api::error('Server error: ' . $e->getMessage(), 500);
}
