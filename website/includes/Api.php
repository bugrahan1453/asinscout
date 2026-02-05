<?php
/**
 * API Helper Functions
 */

class Api {
    
    /**
     * JSON response gönder
     */
    public static function response($data, $code = 200) {
        http_response_code($code);
        header('Content-Type: application/json');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }
    
    /**
     * Başarılı response
     */
    public static function success($data = null, $message = 'Success') {
        self::response([
            'success' => true,
            'message' => $message,
            'data' => $data
        ]);
    }
    
    /**
     * Hata response
     */
    public static function error($message, $code = 400, $errors = null) {
        $response = [
            'success' => false,
            'message' => $message
        ];
        if ($errors) {
            $response['errors'] = $errors;
        }
        self::response($response, $code);
    }
    
    /**
     * POST data al
     */
    public static function getPostData() {
        $json = file_get_contents('php://input');
        $data = json_decode($json, true);
        return $data ?: $_POST;
    }
    
    /**
     * Gerekli alanları kontrol et
     */
    public static function required($data, $fields) {
        $missing = [];
        foreach ($fields as $field) {
            if (!isset($data[$field]) || trim($data[$field]) === '') {
                $missing[] = $field;
            }
        }
        if (!empty($missing)) {
            self::error('Missing required fields: ' . implode(', ', $missing), 400);
        }
    }
    
    /**
     * Email validasyonu
     */
    public static function validateEmail($email) {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            self::error('Invalid email address');
        }
    }
    
    /**
     * CORS headers
     */
    public static function cors() {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = array_map('trim', explode(',', CORS_ORIGIN));

        // Chrome extension origin'lerini de kabul et
        if (in_array($origin, $allowed) || preg_match('/^chrome-extension:\/\//', $origin)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
        } else {
            header('Access-Control-Allow-Origin: ' . $allowed[0]);
        }

        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
        header('Access-Control-Max-Age: 86400');

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }
    
    /**
     * Rate limiting (basit - IP bazlı)
     */
    public static function rateLimit($key, $maxRequests = 60, $window = 60) {
        $cacheFile = sys_get_temp_dir() . '/rate_' . md5($key) . '.json';
        
        $data = [];
        if (file_exists($cacheFile)) {
            $data = json_decode(file_get_contents($cacheFile), true);
        }
        
        $now = time();
        $windowStart = $now - $window;
        
        // Eski kayıtları temizle
        $data = array_filter($data, function($time) use ($windowStart) {
            return $time > $windowStart;
        });
        
        if (count($data) >= $maxRequests) {
            self::error('Rate limit exceeded. Please try again later.', 429);
        }
        
        $data[] = $now;
        file_put_contents($cacheFile, json_encode($data));
    }
    
    /**
     * IP adresi al
     */
    public static function getIp() {
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            return $_SERVER['HTTP_CF_CONNECTING_IP'];
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
            return trim($ips[0]);
        }
        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    }
    
    /**
     * Activity log
     */
    public static function log($userId, $action, $details = []) {
        $db = Database::getInstance();
        $db->insert('activity_logs', [
            'user_id' => $userId,
            'action' => $action,
            'details' => json_encode($details),
            'ip_address' => self::getIp(),
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? ''
        ]);
    }
}
