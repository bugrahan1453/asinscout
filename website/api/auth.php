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
        
        $userId = $db->insert('users', [
            'email' => strtolower(trim($data['email'])),
            'password' => Auth::hashPassword($data['password']),
            'name' => trim($data['name']),
            'role' => $isFirstUser ? 'admin' : 'user',
            'scan_limit' => 0,
            'verify_token' => Auth::generateToken()
        ]);
        
        $token = Auth::createToken($userId, $data['email']);
        Api::log($userId, 'register', ['ip' => Api::getIp()]);
        
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
        $data = Api::getPostData();
        Api::required($data, ['email', 'password']);
        
        $user = $db->fetch(
            "SELECT u.*, p.name as package_name, p.scan_limit as pkg_limit 
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
        $token = Auth::createToken($user['id'], $user['email'], $user['role']);
        Api::log($user['id'], 'login', ['ip' => Api::getIp()]);
        
        // Paket süresi kontrolü
        $hasActivePackage = $user['package_id'] && $user['package_expires'] && strtotime($user['package_expires']) > time();
        
        Api::success([
            'token' => $token,
            'user' => [
                'id' => $user['id'],
                'email' => $user['email'],
                'name' => $user['name'],
                'role' => $user['role'],
                'scan_limit' => $hasActivePackage ? (int)$user['scan_limit'] : 0,
                'package_name' => $hasActivePackage ? $user['package_name'] : null,
                'package_expires' => $hasActivePackage ? $user['package_expires'] : null
            ]
        ]);
        break;
    
    case 'profile':
        $user = Auth::requireAuth();
        
        $fullUser = $db->fetch(
            "SELECT u.*, p.name as package_name 
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
        
        Api::success([
            'user' => [
                'id' => $fullUser['id'],
                'email' => $fullUser['email'],
                'name' => $fullUser['name'],
                'role' => $fullUser['role'],
                'scan_limit' => $hasActivePackage ? (int)$fullUser['scan_limit'] : 0,
                'package_name' => $hasActivePackage ? $fullUser['package_name'] : null,
                'package_expires' => $hasActivePackage ? $fullUser['package_expires'] : null
            ],
            'stats' => [
                'total_scans' => (int)$stats['total_scans'],
                'total_asins' => (int)$stats['total_asins']
            ]
        ]);
        break;
    
    case 'forgot':
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
    
    default:
        Api::error('Invalid action', 400);
}
