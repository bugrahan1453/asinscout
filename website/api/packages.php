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
    
    case 'testimonials':
        $testimonials = $db->fetchAll(
            "SELECT id, name, role, avatar, text, rating FROM testimonials WHERE is_active = 1 ORDER BY sort_order, id"
        ) ?: [];
        Api::success(['testimonials' => $testimonials]);
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

    case 'my_packages':
        // Kullanıcının aktif paketlerini listele
        $user = Auth::requireAuth();

        // Süresi dolmuş paketleri pasife çek
        $db->query(
            "UPDATE user_packages SET is_active = 0 WHERE user_id = ? AND expires_at < NOW() AND is_active = 1",
            [$user['id']]
        );

        $today = date('Y-m-d');

        // Aktif paketleri getir
        $userPackages = $db->fetchAll(
            "SELECT up.id, up.package_id, up.package_name, up.scan_limit,
                    up.daily_scan_limit, up.daily_scans_used, up.last_scan_date,
                    up.purchased_at, up.expires_at, up.is_active,
                    p.slug as package_slug
             FROM user_packages up
             LEFT JOIN packages p ON up.package_id = p.id
             WHERE up.user_id = ? AND up.is_active = 1 AND up.expires_at > NOW()
             ORDER BY up.expires_at ASC",
            [$user['id']]
        ) ?: [];

        foreach ($userPackages as &$up) {
            $up['scan_limit'] = (int)$up['scan_limit'];
            $up['daily_scan_limit'] = (int)$up['daily_scan_limit'];

            // Gün değiştiyse kullanım sıfırlanır
            $dailyUsed = ($up['last_scan_date'] === $today) ? (int)$up['daily_scans_used'] : 0;
            $up['daily_scans_used'] = $dailyUsed;

            // Kalan günlük hak
            $up['daily_remaining'] = $up['daily_scan_limit'] > 0
                ? max(0, $up['daily_scan_limit'] - $dailyUsed)
                : -1; // -1 = sınırsız

            $up['days_remaining'] = max(0, (int)((strtotime($up['expires_at']) - time()) / 86400));
        }

        Api::success(['user_packages' => $userPackages]);
        break;

    case 'validate_discount':
        $user = Auth::requireAuth();
        $data = Api::getPostData();
        Api::required($data, ['code']);

        $code = strtoupper(trim($data['code']));
        $discount = $db->fetch(
            "SELECT * FROM discount_codes WHERE code = ? AND is_active = 1",
            [$code]
        );

        if (!$discount) {
            Api::error('Gecersiz indirim kodu');
        }

        // Geçerlilik tarihi kontrolü
        $now = date('Y-m-d H:i:s');
        if ($discount['valid_from'] && $discount['valid_from'] > $now) {
            Api::error('Bu indirim kodu henuz aktif degil');
        }
        if ($discount['valid_until'] && $discount['valid_until'] < $now) {
            Api::error('Bu indirim kodunun suresi dolmus');
        }

        // Kullanım limiti kontrolü
        if ($discount['max_uses'] !== null && $discount['used_count'] >= $discount['max_uses']) {
            Api::error('Bu indirim kodu kullanim limitine ulasmis');
        }

        Api::success([
            'valid' => true,
            'code' => $discount['code'],
            'discount_type' => $discount['discount_type'],
            'discount_value' => (float)$discount['discount_value'],
            'min_amount' => (float)$discount['min_amount']
        ]);
        break;

    case 'checkout':
        $user = Auth::requireAuth();
        $data = Api::getPostData();
        Api::required($data, ['package_id']);

        $package = $db->fetch("SELECT * FROM packages WHERE id = ? AND is_active = 1", [$data['package_id']]);
        if (!$package) {
            Api::error('Package not found', 404);
        }

        // İndirim kodu kontrolü
        $discountCode = null;
        $discountAmount = 0;
        $originalPrice = (float)$package['price'];
        $finalPrice = $originalPrice;

        if (!empty($data['discount_code'])) {
            $code = strtoupper(trim($data['discount_code']));
            $discount = $db->fetch(
                "SELECT * FROM discount_codes WHERE code = ? AND is_active = 1",
                [$code]
            );

            if ($discount) {
                $now = date('Y-m-d H:i:s');
                $isValid = true;

                // Geçerlilik kontrolü
                if ($discount['valid_from'] && $discount['valid_from'] > $now) $isValid = false;
                if ($discount['valid_until'] && $discount['valid_until'] < $now) $isValid = false;
                if ($discount['max_uses'] !== null && $discount['used_count'] >= $discount['max_uses']) $isValid = false;
                if ($discount['min_amount'] > $originalPrice) $isValid = false;

                if ($isValid) {
                    $discountCode = $discount['code'];

                    if ($discount['discount_type'] === 'percent') {
                        $discountAmount = round($originalPrice * ((float)$discount['discount_value'] / 100), 2);
                    } else {
                        $discountAmount = min((float)$discount['discount_value'], $originalPrice);
                    }

                    $finalPrice = max(0, $originalPrice - $discountAmount);

                    // Kullanım sayısını artır
                    $db->query("UPDATE discount_codes SET used_count = used_count + 1 WHERE id = ?", [$discount['id']]);
                }
            }
        }

        // Stripe key'i veritabanından al (admin panelden ayarlanır)
        $stripeKey = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'stripe_secret_key'");
        if (!$stripeKey || empty($stripeKey['setting_value'])) {
            // Fallback to config
            $stripeSecretKey = defined('STRIPE_SECRET_KEY') ? STRIPE_SECRET_KEY : '';
        } else {
            $stripeSecretKey = $stripeKey['setting_value'];
        }

        if (empty($stripeSecretKey) || $stripeSecretKey === 'sk_live_CHANGE_ME') {
            Api::error('Payment system not configured. Please contact admin.', 500);
        }

        require_once __DIR__ . '/../includes/stripe-php/init.php';
        \Stripe\Stripe::setApiKey($stripeSecretKey);

        try {
            // Ürün açıklaması
            $productDesc = 'Up to ' . number_format($package['scan_limit']) . ' ASINs per scan - ' . $package['duration_days'] . ' days';
            if ($discountCode) {
                $productDesc .= ' (Discount: ' . $discountCode . ')';
            }

            $session = \Stripe\Checkout\Session::create([
                'payment_method_types' => ['card'],
                'customer_email' => $user['email'],
                'line_items' => [[
                    'price_data' => [
                        'currency' => strtolower($package['currency'] ?: 'usd'),
                        'product_data' => [
                            'name' => $package['name'] . ' Package',
                            'description' => $productDesc,
                        ],
                        'unit_amount' => (int)($finalPrice * 100),
                    ],
                    'quantity' => 1,
                ]],
                'mode' => 'payment',
                'success_url' => SITE_URL . '/payment-success.html?session_id={CHECKOUT_SESSION_ID}',
                'cancel_url' => SITE_URL . '/pricing.html',
                'metadata' => [
                    'user_id' => $user['id'],
                    'package_id' => $package['id'],
                    'discount_code' => $discountCode ?: '',
                    'discount_amount' => $discountAmount
                ]
            ]);

            // Kullanıcının affiliate referansını kontrol et
            $userFull = $db->fetch("SELECT referred_by FROM users WHERE id = ?", [$user['id']]);
            $affiliateId = $userFull ? $userFull['referred_by'] : null;

            $db->insert('orders', [
                'user_id' => $user['id'],
                'package_id' => $package['id'],
                'stripe_session_id' => $session->id,
                'amount' => $finalPrice,
                'original_amount' => $originalPrice,
                'discount_code' => $discountCode,
                'discount_amount' => $discountAmount,
                'currency' => $package['currency'] ?: 'USD',
                'status' => 'pending',
                'affiliate_id' => $affiliateId
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
            "SELECT o.*, p.scan_limit, p.duration_days, p.name as package_name, o.affiliate_id FROM orders o
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

        // Stripe key'i veritabanından al
        $stripeKey = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'stripe_secret_key'");
        $stripeSecretKey = ($stripeKey && !empty($stripeKey['setting_value']))
            ? $stripeKey['setting_value']
            : (defined('STRIPE_SECRET_KEY') ? STRIPE_SECRET_KEY : '');

        require_once __DIR__ . '/../includes/stripe-php/init.php';
        \Stripe\Stripe::setApiKey($stripeSecretKey);
        
        try {
            $session = \Stripe\Checkout\Session::retrieve($sessionId);
            
            if ($session->payment_status === 'paid') {
                // Kullanıcıya paketi ata
                $expiresAt = date('Y-m-d H:i:s', strtotime('+' . $order['duration_days'] . ' days'));

                // Eski sistem için (geriye uyumluluk)
                $db->query(
                    "UPDATE users SET package_id = ?, scan_limit = ?, package_expires = ? WHERE id = ?",
                    [$order['package_id'], $order['scan_limit'], $expiresAt, $order['user_id']]
                );

                // Yeni çoklu paket sistemi - user_packages tablosuna ekle
                $pkg = $db->fetch("SELECT name, scan_limit, daily_scan_limit FROM packages WHERE id = ?", [$order['package_id']]);
                $db->insert('user_packages', [
                    'user_id' => $order['user_id'],
                    'package_id' => $order['package_id'],
                    'package_name' => $pkg['name'] ?? $order['package_name'],
                    'scan_limit' => (int)$order['scan_limit'],
                    'daily_scan_limit' => (int)($pkg['daily_scan_limit'] ?? 0),
                    'daily_scans_used' => 0,
                    'last_scan_date' => null,
                    'order_id' => $order['id'],
                    'expires_at' => $expiresAt,
                    'is_active' => 1
                ]);
                
                $db->query(
                    "UPDATE orders SET status = 'completed', stripe_payment_id = ?, completed_at = NOW() WHERE id = ?",
                    [$session->payment_intent, $order['id']]
                );
                
                // Affiliate komisyon hesaplama
                $orderAffiliateId = $order['affiliate_id'] ?? null;
                if (!$orderAffiliateId) {
                    // Order'da yoksa kullanıcıdan kontrol et
                    $refUser = $db->fetch("SELECT referred_by FROM users WHERE id = ?", [$order['user_id']]);
                    $orderAffiliateId = $refUser ? $refUser['referred_by'] : null;
                }

                if ($orderAffiliateId) {
                    $affiliate = $db->fetch("SELECT id, commission_rate, is_active FROM affiliates WHERE id = ? AND is_active = 1", [$orderAffiliateId]);
                    if ($affiliate) {
                        $commissionAmount = round(((float)$order['amount'] * (float)$affiliate['commission_rate']) / 100, 2);

                        $db->insert('affiliate_earnings', [
                            'affiliate_id' => $affiliate['id'],
                            'order_id' => $order['id'],
                            'user_id' => $order['user_id'],
                            'order_amount' => $order['amount'],
                            'commission_rate' => $affiliate['commission_rate'],
                            'commission_amount' => $commissionAmount,
                            'status' => 'pending'
                        ]);

                        // Affiliate istatistiklerini güncelle
                        $db->query(
                            "UPDATE affiliates SET total_orders = total_orders + 1, total_earnings = total_earnings + ? WHERE id = ?",
                            [$commissionAmount, $affiliate['id']]
                        );

                        // Order'a affiliate_id ekle (yoksa)
                        if (!$order['affiliate_id']) {
                            $db->query("UPDATE orders SET affiliate_id = ? WHERE id = ?", [$affiliate['id'], $order['id']]);
                        }
                    }
                }

                Api::log($order['user_id'], 'purchase', [
                    'order_id' => $order['id'],
                    'package' => $order['package_name'],
                    'affiliate_id' => $orderAffiliateId
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
