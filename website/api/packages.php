<?php
/**
 * ASIN Scout Pro - Packages API v2
 */

require_once __DIR__ . '/../includes/bootstrap.php';

$action = $_GET['action'] ?? '';
$db = Database::getInstance();

switch ($action) {
    
    case 'extension_url':
        // Get extension download URL from settings
        $extUrl = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'extension_url'");
        $chromeStore = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'chrome_store_url'");
        
        Api::success([
            'url' => $extUrl ? $extUrl['setting_value'] : null,
            'chrome_store' => $chromeStore ? $chromeStore['setting_value'] : null
        ]);
        break;
    
    case 'list':
        $packages = $db->fetchAll(
            "SELECT id, name, slug, scan_limit, daily_scan_limit, duration_days, price, currency, description, features, is_popular
             FROM packages WHERE is_active = 1 ORDER BY sort_order"
        );
        
        foreach ($packages as &$pkg) {
            $pkg['features'] = json_decode($pkg['features'], true) ?: [];
            $pkg['price'] = (float)$pkg['price'];
            $pkg['scan_limit'] = (int)$pkg['scan_limit'];
            $pkg['daily_scan_limit'] = (int)($pkg['daily_scan_limit'] ?? 0);
            $pkg['duration_days'] = (int)$pkg['duration_days'];
            $pkg['is_popular'] = (bool)$pkg['is_popular'];
        }
        
        Api::success(['packages' => $packages]);
        break;
    
    case 'checkout':
        $user = Auth::requireAuth();
        $data = Api::getPostData();
        Api::required($data, ['package_id']);
        
        $package = $db->fetch("SELECT * FROM packages WHERE id = ? AND is_active = 1", [$data['package_id']]);
        if (!$package) {
            Api::error('Package not found', 404);
        }
        
        require_once __DIR__ . '/../includes/stripe-php/init.php';
        \Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);
        
        try {
            $session = \Stripe\Checkout\Session::create([
                'payment_method_types' => ['card'],
                'customer_email' => $user['email'],
                'line_items' => [[
                    'price_data' => [
                        'currency' => strtolower($package['currency'] ?: 'usd'),
                        'product_data' => [
                            'name' => $package['name'] . ' Package',
                            'description' => 'Up to ' . number_format($package['scan_limit']) . ' ASINs per scan - ' . $package['duration_days'] . ' days',
                        ],
                        'unit_amount' => (int)($package['price'] * 100),
                    ],
                    'quantity' => 1,
                ]],
                'mode' => 'payment',
                'success_url' => SITE_URL . '/payment-success.html?session_id={CHECKOUT_SESSION_ID}',
                'cancel_url' => SITE_URL . '/pricing.html',
                'metadata' => [
                    'user_id' => $user['id'],
                    'package_id' => $package['id']
                ]
            ]);
            
            $db->insert('orders', [
                'user_id' => $user['id'],
                'package_id' => $package['id'],
                'stripe_session_id' => $session->id,
                'amount' => $package['price'],
                'currency' => $package['currency'] ?: 'USD',
                'status' => 'pending'
            ]);
            
            Api::success([
                'checkout_url' => $session->url,
                'session_id' => $session->id
            ]);
            
        } catch (\Stripe\Exception\ApiErrorException $e) {
            Api::error('Payment error: ' . $e->getMessage(), 500);
        }
        break;
    
    case 'success':
        $sessionId = $_GET['session_id'] ?? '';
        if (!$sessionId) {
            Api::error('Invalid session');
        }
        
        $order = $db->fetch(
            "SELECT o.*, p.scan_limit, p.duration_days, p.name as package_name FROM orders o 
             JOIN packages p ON o.package_id = p.id 
             WHERE o.stripe_session_id = ?",
            [$sessionId]
        );
        
        if (!$order) {
            Api::error('Order not found', 404);
        }
        
        if ($order['status'] === 'completed') {
            Api::success([
                'message' => 'Payment already processed',
                'package_name' => $order['package_name'],
                'scan_limit' => $order['scan_limit']
            ]);
            break;
        }
        
        require_once __DIR__ . '/../includes/stripe-php/init.php';
        \Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);
        
        try {
            $session = \Stripe\Checkout\Session::retrieve($sessionId);
            
            if ($session->payment_status === 'paid') {
                // Kullanıcıya paketi ata
                $expiresAt = date('Y-m-d H:i:s', strtotime('+' . $order['duration_days'] . ' days'));
                
                $db->query(
                    "UPDATE users SET package_id = ?, scan_limit = ?, package_expires = ? WHERE id = ?",
                    [$order['package_id'], $order['scan_limit'], $expiresAt, $order['user_id']]
                );
                
                $db->query(
                    "UPDATE orders SET status = 'completed', stripe_payment_id = ?, completed_at = NOW() WHERE id = ?",
                    [$session->payment_intent, $order['id']]
                );
                
                Api::log($order['user_id'], 'purchase', [
                    'order_id' => $order['id'],
                    'package' => $order['package_name']
                ]);
                
                Api::success([
                    'message' => 'Payment successful!',
                    'package_name' => $order['package_name'],
                    'scan_limit' => $order['scan_limit'],
                    'expires' => $expiresAt
                ]);
            } else {
                Api::error('Payment not completed', 400);
            }
            
        } catch (\Stripe\Exception\ApiErrorException $e) {
            Api::error('Verification error', 500);
        }
        break;
    
    default:
        Api::error('Invalid action', 400);
}
