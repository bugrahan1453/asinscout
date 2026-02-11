<?php
/**
 * Authentication Helper
 * JWT Token management
 */

class Auth {
    
    /**
     * JWT Token oluştur
     * @param bool $rememberMe - true ise 30 gün, false ise normal JWT_EXPIRY (7 gün)
     */
    public static function createToken($userId, $email, $role = 'user', $rememberMe = false) {
        $header = self::base64UrlEncode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));

        // Beni hatırla seçiliyse 30 gün, değilse normal süre
        $expiry = $rememberMe ? (86400 * 30) : JWT_EXPIRY;

        $payload = self::base64UrlEncode(json_encode([
            'user_id' => $userId,
            'email' => $email,
            'role' => $role,
            'iat' => time(),
            'exp' => time() + $expiry
        ]));

        $signature = self::base64UrlEncode(
            hash_hmac('sha256', "$header.$payload", JWT_SECRET, true)
        );

        return "$header.$payload.$signature";
    }
    
    /**
     * JWT Token doğrula
     */
    public static function verifyToken($token) {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return false;
        }
        
        list($header, $payload, $signature) = $parts;
        
        // Signature kontrolü
        $expectedSignature = self::base64UrlEncode(
            hash_hmac('sha256', "$header.$payload", JWT_SECRET, true)
        );
        
        if (!hash_equals($expectedSignature, $signature)) {
            return false;
        }
        
        // Payload decode
        $data = json_decode(self::base64UrlDecode($payload), true);
        
        // Expiry kontrolü
        if (!isset($data['exp']) || $data['exp'] < time()) {
            return false;
        }
        
        return $data;
    }
    
    /**
     * Request'ten token al
     */
    public static function getTokenFromRequest() {
        // Header'dan
        $headers = getallheaders();
        if (isset($headers['Authorization'])) {
            if (preg_match('/Bearer\s+(.*)$/i', $headers['Authorization'], $matches)) {
                return $matches[1];
            }
        }
        
        // Query string'den
        if (isset($_GET['token'])) {
            return $_GET['token'];
        }
        
        return null;
    }
    
    /**
     * Kullanıcı doğrula ve bilgilerini döndür
     */
    public static function authenticate() {
        $token = self::getTokenFromRequest();
        if (!$token) {
            return null;
        }
        
        $payload = self::verifyToken($token);
        if (!$payload) {
            return null;
        }
        
        // Kullanıcıyı DB'den çek (güncel bilgiler için)
        $db = Database::getInstance();
        $user = $db->fetch(
            "SELECT id, email, name, scan_limit, role, status FROM users WHERE id = ? AND status = 'active'",
            [$payload['user_id']]
        );
        
        return $user;
    }
    
    /**
     * Admin kontrolü
     */
    public static function requireAdmin() {
        $user = self::authenticate();
        if (!$user || $user['role'] !== 'admin') {
            http_response_code(403);
            echo json_encode(['error' => 'Admin access required']);
            exit;
        }
        return $user;
    }
    
    /**
     * Kullanıcı kontrolü
     */
    public static function requireAuth() {
        $user = self::authenticate();
        if (!$user) {
            http_response_code(401);
            echo json_encode(['error' => 'Authentication required']);
            exit;
        }
        return $user;
    }
    
    /**
     * Şifre hash'le
     */
    public static function hashPassword($password) {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
    }
    
    /**
     * Şifre doğrula
     */
    public static function verifyPassword($password, $hash) {
        return password_verify($password, $hash);
    }
    
    /**
     * Rastgele token oluştur
     */
    public static function generateToken($length = 32) {
        return bin2hex(random_bytes($length));
    }
    
    private static function base64UrlEncode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
    
    private static function base64UrlDecode($data) {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
