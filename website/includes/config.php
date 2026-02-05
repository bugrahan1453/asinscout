<?php
/**
 * ASIN Scout Pro - Configuration
 * Bu dosyayı config.php olarak kopyalayın ve ayarlarınızı girin
 */

// Hata gösterimi (production'da false yapın)
define('DEBUG_MODE', false);
if (DEBUG_MODE) {
    error_reporting(E_ALL);
    ini_set('display_errors', 1);
} else {
    error_reporting(0);
    ini_set('display_errors', 0);
}

// Site Ayarları
define('SITE_NAME', 'ASIN Scout Pro');
define('SITE_URL', 'https://asinscout.com'); // Kendi domain'inizi yazın
define('SITE_EMAIL', 'support@asinscout.com');

// Veritabanı Ayarları (cPanel'den alın)
define('DB_HOST', 'localhost');
define('DB_NAME', 'asinscout_asin_scout');
define('DB_USER', 'asinscout_admin');
define('DB_PASS', 'CHANGE_ME'); // cPanel database password
define('DB_CHARSET', 'utf8mb4');

// Güvenlik
define('JWT_SECRET', 'CHANGE_ME_RANDOM_64_CHAR_HEX_STRING');
define('JWT_EXPIRY', 86400 * 7); // 7 gün
// CORS: Kendi domain + Chrome extension origin
define('CORS_ORIGIN', 'https://asinscout.com');

// Stripe Ayarları (Stripe Dashboard'dan alın)
define('STRIPE_PUBLIC_KEY', 'pk_live_CHANGE_ME'); // Stripe Dashboard > API Keys
define('STRIPE_SECRET_KEY', 'sk_live_CHANGE_ME'); // Stripe Dashboard > API Keys
define('STRIPE_WEBHOOK_SECRET', ''); // Not used - success page verifies directly
define('STRIPE_CURRENCY', 'USD');

// Email Ayarları (SMTP - cPanel'den veya SendGrid/Mailgun)
define('SMTP_HOST', 'mail.asinscout.com');
define('SMTP_PORT', 587);
define('SMTP_USER', 'support@asinscout.com');
define('SMTP_PASS', 'CHANGE_ME'); // cPanel email password
define('SMTP_FROM', 'support@asinscout.com');
define('SMTP_FROM_NAME', 'ASIN Scout Pro');

// Uygulama Ayarları
define('FREE_TRIAL_LIMIT', 1000); // Ücretsiz deneme limiti
define('MIN_SCAN_WARNING', 500); // Düşük limit uyarısı
define('MAX_SCAN_ASINS', 500000); // Tek taramada max ASIN

// Zaman dilimi
date_default_timezone_set('Europe/Istanbul');

// Session ayarları
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_secure', 1);
ini_set('session.use_strict_mode', 1);
