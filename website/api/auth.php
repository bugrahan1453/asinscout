<?php
/**
 * ASIN Scout Pro - Auth API v2
 * Paket bazlı sistem (kredi yok)
 */

require_once __DIR__ . '/../includes/bootstrap.php';

$action = $_GET['action'] ?? '';
$db = Database::getInstance();

switch ($action) {
    
    case 'register':
        Api::rateLimit('register_' . Api::getIp(), 5, 300); // 5 register per 5 min
        $data = Api::getPostData();
        Api::required($data, ['email', 'password', 'name']);
        Api::validateEmail($data['email']);
        
        if (strlen($data['password']) < 6) {
            Api::error('Password must be at least 6 characters');
        }
        
        $existing = $db->fetch("SELECT id FROM users WHERE email = ?", [strtolower(trim($data['email']))]);
        if ($existing) {
            Api::error('Email already registered');
        }
        
        // İlk kullanıcı otomatik admin olsun
        $userCount = $db->fetch("SELECT COUNT(*) as cnt FROM users");
        $isFirstUser = ($userCount['cnt'] == 0);
        
        // Affiliate referans kontrolü
        $referredBy = null;
        if (!empty($data['ref'])) {
            $affiliate = $db->fetch("SELECT id FROM affiliates WHERE code = ? AND is_active = 1", [strtolower(trim($data['ref']))]);
            if ($affiliate) {
                $referredBy = (int)$affiliate['id'];
            }
        }

        $userId = $db->insert('users', [
            'email' => strtolower(trim($data['email'])),
            'password' => Auth::hashPassword($data['password']),
            'name' => trim($data['name']),
            'role' => $isFirstUser ? 'admin' : 'user',
            'scan_limit' => 0,
            'verify_token' => Auth::generateToken(),
            'referred_by' => $referredBy
        ]);

        // Affiliate referral sayısını güncelle
        if ($referredBy) {
            $db->query("UPDATE affiliates SET total_referrals = total_referrals + 1 WHERE id = ?", [$referredBy]);
        }

        $token = Auth::createToken($userId, $data['email']);
        Api::log($userId, 'register', ['ip' => Api::getIp(), 'ref' => $data['ref'] ?? null]);

        // Hoşgeldin emaili gönder
        try {
            Mailer::sendWelcome($data['email'], trim($data['name']), 0);
        } catch (Exception $e) {
            // Email hatası kayıt işlemini engellemesin
            error_log("Welcome email failed: " . $e->getMessage());
        }

        Api::success([
            'token' => $token,
            'user' => [
                'id' => $userId,
                'email' => $data['email'],
                'name' => $data['name'],
                'role' => $isFirstUser ? 'admin' : 'user',
                'scan_limit' => 0,
                'package_name' => null,
                'package_expires' => null
            ]
        ], 'Registration successful! Please purchase a package to start scanning.');
        break;
    
    case 'login':
        Api::rateLimit('login_' . Api::getIp(), 10, 300); // 10 login per 5 min
        $data = Api::getPostData();
        Api::required($data, ['email', 'password']);
        
        $user = $db->fetch(
            "SELECT u.*, p.name as package_name, p.scan_limit as pkg_limit, p.daily_scan_limit as pkg_daily_limit
             FROM users u
             LEFT JOIN packages p ON u.package_id = p.id
             WHERE u.email = ?",
            [strtolower(trim($data['email']))]
        );
        
        if (!$user || !Auth::verifyPassword($data['password'], $user['password'])) {
            Api::error('Invalid email or password', 401);
        }
        
        if ($user['status'] !== 'active') {
            Api::error('Account is suspended', 403);
        }
        
        $db->query("UPDATE users SET last_login = NOW() WHERE id = ?", [$user['id']]);
        $rememberMe = !empty($data['remember_me']);
        $token = Auth::createToken($user['id'], $user['email'], $user['role'], $rememberMe);
        Api::log($user['id'], 'login', ['ip' => Api::getIp(), 'remember_me' => $rememberMe]);

        // Paket süresi kontrolü
        $hasActivePackage = $user['package_id'] && $user['package_expires'] && strtotime($user['package_expires']) > time();

        // Günlük tarama bilgisi (paketten al)
        $dailyLimit = (int)($user['pkg_daily_limit'] ?? 0);
        $dailyUsed = (int)($user['daily_scans_used'] ?? 0);
        if (($user['last_scan_date'] ?? '') !== date('Y-m-d')) {
            $dailyUsed = 0;
        }

        Api::success([
            'token' => $token,
            'user' => [
                'id' => $user['id'],
                'email' => $user['email'],
                'name' => $user['name'],
                'role' => $user['role'],
                'scan_limit' => $hasActivePackage ? (int)$user['scan_limit'] : 0,
                'package_name' => $hasActivePackage ? $user['package_name'] : null,
                'package_expires' => $hasActivePackage ? $user['package_expires'] : null,
                'daily_scan_limit' => $dailyLimit,
                'daily_scans_used' => $dailyUsed,
                'daily_remaining' => $dailyLimit > 0 ? max(0, $dailyLimit - $dailyUsed) : -1
            ]
        ]);
        break;
    
    case 'profile':
        $user = Auth::requireAuth();
        
        $fullUser = $db->fetch(
            "SELECT u.*, p.name as package_name, p.daily_scan_limit as pkg_daily_limit
             FROM users u
             LEFT JOIN packages p ON u.package_id = p.id
             WHERE u.id = ?",
            [$user['id']]
        );
        
        $stats = $db->fetch(
            "SELECT COUNT(*) as total_scans, COALESCE(SUM(asin_count), 0) as total_asins 
             FROM scans WHERE user_id = ?",
            [$user['id']]
        );
        
        $hasActivePackage = $fullUser['package_id'] && $fullUser['package_expires'] && strtotime($fullUser['package_expires']) > time();
        
        // Günlük tarama bilgisi
        $dailyLimit = (int)($fullUser['pkg_daily_limit'] ?? 0);
        $dailyUsed = (int)($fullUser['daily_scans_used'] ?? 0);
        if (($fullUser['last_scan_date'] ?? '') !== date('Y-m-d')) {
            $dailyUsed = 0;
        }

        // Kullanıcı affiliate mi kontrol et
        $affiliate = $db->fetch(
            "SELECT id, code FROM affiliates WHERE user_id = ? AND is_active = 1",
            [$user['id']]
        );

        Api::success([
            'user' => [
                'id' => $fullUser['id'],
                'email' => $fullUser['email'],
                'name' => $fullUser['name'],
                'role' => $fullUser['role'],
                'scan_limit' => $hasActivePackage ? (int)$fullUser['scan_limit'] : 0,
                'package_name' => $hasActivePackage ? $fullUser['package_name'] : null,
                'package_expires' => $hasActivePackage ? $fullUser['package_expires'] : null,
                'daily_scan_limit' => $dailyLimit,
                'daily_scans_used' => $dailyUsed,
                'daily_remaining' => $dailyLimit > 0 ? max(0, $dailyLimit - $dailyUsed) : -1,
                'is_affiliate' => $affiliate ? true : false,
                'affiliate_code' => $affiliate ? $affiliate['code'] : null
            ],
            'stats' => [
                'total_scans' => (int)$stats['total_scans'],
                'total_asins' => (int)$stats['total_asins']
            ]
        ]);
        break;
    
    case 'forgot':
        Api::rateLimit('forgot_' . Api::getIp(), 3, 600); // 3 reset per 10 min
        $data = Api::getPostData();
        Api::required($data, ['email']);
        
        $user = $db->fetch("SELECT id, email, name FROM users WHERE email = ?", 
            [strtolower(trim($data['email']))]);
        
        if ($user) {
            $resetToken = Auth::generateToken();
            $db->query(
                "UPDATE users SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?",
                [$resetToken, $user['id']]
            );
            Mailer::sendPasswordReset($user['email'], $user['name'], $resetToken);
        }
        
        Api::success(null, 'If email exists, reset instructions have been sent');
        break;
    
    case 'reset':
        $data = Api::getPostData();
        Api::required($data, ['token', 'password']);
        
        if (strlen($data['password']) < 6) {
            Api::error('Password must be at least 6 characters');
        }
        
        $user = $db->fetch(
            "SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW()",
            [$data['token']]
        );
        
        if (!$user) {
            Api::error('Invalid or expired reset token', 400);
        }
        
        $db->query(
            "UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?",
            [Auth::hashPassword($data['password']), $user['id']]
        );
        
        Api::success(null, 'Password has been reset successfully');
        break;
    
    case 'update':
        $user = Auth::requireAuth();
        $data = Api::getPostData();
        
        $updates = [];
        if (isset($data['name']) && trim($data['name'])) {
            $updates['name'] = trim($data['name']);
        }
        
        if (isset($data['current_password']) && isset($data['new_password'])) {
            $currentUser = $db->fetch("SELECT password FROM users WHERE id = ?", [$user['id']]);
            if (!Auth::verifyPassword($data['current_password'], $currentUser['password'])) {
                Api::error('Current password is incorrect');
            }
            if (strlen($data['new_password']) < 6) {
                Api::error('New password must be at least 6 characters');
            }
            $updates['password'] = Auth::hashPassword($data['new_password']);
        }
        
        if (!empty($updates)) {
            $db->update('users', $updates, 'id = :id', ['id' => $user['id']]);
        }
        
        Api::success(null, 'Profile updated successfully');
        break;
    
    case 'contact':
        Api::rateLimit('contact_' . Api::getIp(), 3, 600); // 3 messages per 10 min
        $data = Api::getPostData();
        Api::required($data, ['name', 'email', 'message']);
        Api::validateEmail($data['email']);

        $subject = trim($data['subject'] ?? 'general');
        $name = trim($data['name']);
        $email = strtolower(trim($data['email']));
        $text = trim($data['message']);

        if (strlen($text) < 10) {
            Api::error('Message must be at least 10 characters');
        }

        // Send email to admin
        $body = "New contact form submission:\n\n";
        $body .= "Name: {$name}\n";
        $body .= "Email: {$email}\n";
        $body .= "Subject: {$subject}\n";
        $body .= "Message:\n{$text}\n";

        Mailer::sendRaw(SITE_EMAIL, "Contact: {$subject} - {$name}", $body, $email);

        Api::success(null, 'Message sent successfully');
        break;

    case 'affiliate_dashboard':
        $user = Auth::requireAuth();

        // Kullanıcının affiliate kaydı var mı kontrol et (email ile eşleştir)
        $affiliate = $db->fetch(
            "SELECT * FROM affiliates WHERE user_id = ? OR LOWER(name) = LOWER(?)",
            [$user['id'], $user['email']]
        );

        if (!$affiliate) {
            Api::error('Affiliate kaydınız bulunamadı', 404);
        }

        // Referral olan kullanıcılar
        $referrals = $db->fetchAll(
            "SELECT id, name, email, created_at FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 100",
            [$affiliate['id']]
        );

        // Kazançlar (detaylı)
        $earnings = $db->fetchAll(
            "SELECT ae.*, u.name as user_name, u.email as user_email,
                    o.amount as order_amount, p.name as package_name
             FROM affiliate_earnings ae
             JOIN users u ON ae.user_id = u.id
             JOIN orders o ON ae.order_id = o.id
             JOIN packages p ON o.package_id = p.id
             WHERE ae.affiliate_id = ?
             ORDER BY ae.created_at DESC",
            [$affiliate['id']]
        );

        // Toplam istatistikler
        $totalReferrals = count($referrals);
        $totalOrders = count($earnings);
        $totalEarnings = array_sum(array_column($earnings, 'commission_amount'));
        $pendingEarnings = array_sum(array_map(function($e) {
            return $e['status'] !== 'paid' ? $e['commission_amount'] : 0;
        }, $earnings));
        $paidEarnings = $totalEarnings - $pendingEarnings;

        Api::success([
            'affiliate' => [
                'id' => $affiliate['id'],
                'name' => $affiliate['name'],
                'code' => $affiliate['code'],
                'commission_rate' => $affiliate['commission_rate'],
                'link' => SITE_URL . '/register.html?ref=' . $affiliate['code']
            ],
            'stats' => [
                'total_referrals' => $totalReferrals,
                'total_orders' => $totalOrders,
                'total_earnings' => round($totalEarnings, 2),
                'pending_earnings' => round($pendingEarnings, 2),
                'paid_earnings' => round($paidEarnings, 2)
            ],
            'referrals' => array_map(function($r) {
                return [
                    'name' => $r['name'],
                    'email' => substr($r['email'], 0, 3) . '***' . strstr($r['email'], '@'),
                    'date' => $r['created_at']
                ];
            }, $referrals),
            'earnings' => array_map(function($e) {
                return [
                    'user' => $e['user_name'],
                    'package' => $e['package_name'],
                    'order_amount' => $e['order_amount'],
                    'commission' => $e['commission_amount'],
                    'status' => $e['status'],
                    'date' => $e['created_at']
                ];
            }, $earnings)
        ]);
        break;

    default:
        Api::error('Invalid action', 400);
}
