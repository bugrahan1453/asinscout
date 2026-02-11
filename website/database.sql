-- ASIN Scout Pro - Database Setup
-- phpMyAdmin veya cPanel MySQL üzerinden çalıştırın
-- Veritabanı: asinscout_asin_scout

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

-- --------------------------------------------------------
-- Packages tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `packages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(50) NOT NULL,
  `scan_limit` int(11) NOT NULL COMMENT 'Tarama başına max ASIN',
  `daily_scan_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Günlük tarama hakkı (0 = sınırsız)',
  `duration_days` int(11) DEFAULT 30,
  `price` decimal(10,2) NOT NULL,
  `currency` varchar(3) DEFAULT 'USD',
  `stripe_price_id` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `features` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`features`)),
  `is_popular` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Users tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `package_id` int(11) DEFAULT NULL,
  `scan_limit` int(11) DEFAULT 0 COMMENT 'Tarama başına max ASIN',
  `daily_scan_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Günlük tarama hakkı (0 = sınırsız)',
  `daily_scans_used` int(11) NOT NULL DEFAULT 0 COMMENT 'Bugün kullanılan tarama sayısı',
  `last_scan_date` date DEFAULT NULL COMMENT 'Son tarama tarihi (günlük reset için)',
  `referred_by` int(11) DEFAULT NULL COMMENT 'Affiliate ID',
  `package_expires` datetime DEFAULT NULL,
  `total_scans` int(11) DEFAULT 0,
  `total_asins` int(11) DEFAULT 0,
  `stripe_customer_id` varchar(100) DEFAULT NULL,
  `email_verified` tinyint(1) DEFAULT 0,
  `verify_token` varchar(100) DEFAULT NULL,
  `reset_token` varchar(100) DEFAULT NULL,
  `reset_expires` datetime DEFAULT NULL,
  `status` enum('active','suspended','deleted') DEFAULT 'active',
  `role` enum('user','admin') DEFAULT 'user',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `last_login` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Scans tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `scans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `store_name` varchar(255) DEFAULT NULL,
  `store_url` text DEFAULT NULL,
  `marketplace` varchar(20) DEFAULT NULL,
  `asin_count` int(11) DEFAULT 0,
  `pages_scanned` int(11) DEFAULT 0,
  `duration_seconds` int(11) DEFAULT NULL,
  `status` enum('running','completed','stopped','error') DEFAULT 'running',
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `scans_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Scan ASINs tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `scan_asins` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `scan_id` int(11) NOT NULL,
  `asin` varchar(10) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_scan` (`scan_id`),
  CONSTRAINT `scan_asins_ibfk_1` FOREIGN KEY (`scan_id`) REFERENCES `scans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Orders tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `package_id` int(11) NOT NULL,
  `stripe_payment_id` varchar(100) DEFAULT NULL,
  `stripe_session_id` varchar(100) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `original_amount` decimal(10,2) DEFAULT NULL COMMENT 'İndirim öncesi tutar',
  `discount_code` varchar(50) DEFAULT NULL COMMENT 'Kullanılan indirim kodu',
  `discount_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'İndirim tutarı',
  `currency` varchar(3) DEFAULT 'USD',
  `status` enum('pending','completed','failed','refunded') DEFAULT 'pending',
  `affiliate_id` int(11) DEFAULT NULL COMMENT 'Affiliate ID',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `package_id` (`package_id`),
  KEY `idx_stripe_session` (`stripe_session_id`),
  KEY `idx_affiliate` (`affiliate_id`),
  CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`package_id`) REFERENCES `packages` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Transactions tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `stripe_payment_id` varchar(255) DEFAULT NULL,
  `stripe_invoice_id` varchar(255) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(10) DEFAULT 'USD',
  `plan` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT 'pending',
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_stripe` (`stripe_payment_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Activity Logs tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- API Keys tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `api_key` varchar(255) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `last_used_at` datetime DEFAULT NULL,
  `requests_count` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_key` (`api_key`),
  KEY `user_id` (`user_id`),
  KEY `idx_key` (`api_key`),
  CONSTRAINT `api_keys_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Password Resets tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Settings tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `setting_type` enum('string','number','boolean','json') DEFAULT 'string',
  `description` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Varsayılan veriler
-- --------------------------------------------------------

-- Admin kullanıcısı (şifre: password - ÜRETİMDE DEĞİŞTİRİN!)
INSERT INTO `users` (`email`, `password`, `name`, `role`, `status`, `scan_limit`, `email_verified`) VALUES
('admin@asinscout.com', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Admin', 'admin', 'active', 999999, 1)
ON DUPLICATE KEY UPDATE `role` = 'admin';

-- Varsayılan ayarlar
INSERT INTO `settings` (`setting_key`, `setting_value`, `setting_type`, `description`) VALUES
('site_name', 'ASIN Scout Pro', 'string', 'Site name'),
('site_url', 'https://asinscout.com', 'string', 'Site URL'),
('stripe_public_key', '', 'string', 'Stripe Public Key'),
('stripe_secret_key', '', 'string', 'Stripe Secret Key'),
('stripe_webhook_secret', '', 'string', 'Stripe Webhook Secret'),
('smtp_host', '', 'string', 'SMTP Host'),
('smtp_port', '587', 'number', 'SMTP Port'),
('smtp_user', '', 'string', 'SMTP Username'),
('smtp_pass', '', 'string', 'SMTP Password'),
('smtp_from', '', 'string', 'SMTP From Email'),
('free_trial_days', '0', 'number', 'Free trial days'),
('maintenance_mode', '0', 'boolean', 'Maintenance mode'),
('admin_email', 'support@asinscout.com', 'string', 'Admin email'),
('free_scans', '0', 'string', 'Free scan count for new users')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;

COMMIT;

-- --------------------------------------------------------
-- Affiliates tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `affiliates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT 'Affiliate ismi (admin belirler)',
  `code` varchar(50) NOT NULL COMMENT 'Referans kodu (link için)',
  `user_id` int(11) DEFAULT NULL COMMENT 'Bağlı kullanıcı ID',
  `commission_rate` decimal(5,2) NOT NULL DEFAULT 5.00 COMMENT 'Komisyon oranı (%)',
  `total_earnings` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Toplam kazanç',
  `total_referrals` int(11) NOT NULL DEFAULT 0 COMMENT 'Toplam yönlendirilen kullanıcı',
  `total_orders` int(11) NOT NULL DEFAULT 0 COMMENT 'Toplam sipariş',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` text DEFAULT NULL COMMENT 'Admin notları',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Affiliate Earnings tablosu
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `affiliate_earnings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `affiliate_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL COMMENT 'Yönlendirilen kullanıcı',
  `order_amount` decimal(10,2) NOT NULL,
  `commission_rate` decimal(5,2) NOT NULL COMMENT 'Sipariş anındaki oran',
  `commission_amount` decimal(10,2) NOT NULL COMMENT 'Hesaplanan komisyon',
  `status` enum('pending','approved','paid') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_affiliate` (`affiliate_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `affiliate_earnings_ibfk_1` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `affiliate_earnings_ibfk_2` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `affiliate_earnings_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- MEVCUT VERİTABANINA GÜNCELLEME
-- Eğer tablolar zaten varsa, eksik kolonları eklemek için:
-- --------------------------------------------------------
-- ALTER TABLE `packages` ADD COLUMN `daily_scan_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Günlük tarama hakkı (0 = sınırsız)' AFTER `scan_limit`;
-- ALTER TABLE `users` ADD COLUMN `daily_scan_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Günlük tarama hakkı' AFTER `scan_limit`;
-- ALTER TABLE `users` ADD COLUMN `daily_scans_used` int(11) NOT NULL DEFAULT 0 COMMENT 'Bugün kullanılan tarama' AFTER `daily_scan_limit`;
-- ALTER TABLE `users` ADD COLUMN `last_scan_date` date DEFAULT NULL COMMENT 'Son tarama tarihi' AFTER `daily_scans_used`;
-- ALTER TABLE `users` ADD COLUMN `referred_by` int(11) DEFAULT NULL COMMENT 'Affiliate ID' AFTER `last_scan_date`;
-- ALTER TABLE `orders` ADD COLUMN `affiliate_id` int(11) DEFAULT NULL COMMENT 'Affiliate ID' AFTER `status`;
-- ALTER TABLE `orders` ADD COLUMN `discount_code` varchar(50) DEFAULT NULL COMMENT 'Kullanılan indirim kodu' AFTER `affiliate_id`;
-- ALTER TABLE `orders` ADD COLUMN `discount_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'İndirim tutarı' AFTER `discount_code`;
-- ALTER TABLE `orders` ADD COLUMN `original_amount` decimal(10,2) DEFAULT NULL COMMENT 'Orijinal tutar' AFTER `discount_amount`;

-- --------------------------------------------------------
-- Testimonials tablosu (Müşteri yorumları)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `testimonials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT 'Müşteri adı',
  `role` varchar(100) DEFAULT NULL COMMENT 'Ünvan/Rol',
  `avatar` varchar(10) DEFAULT NULL COMMENT 'Avatar harfi (örn: M, S, D)',
  `text` text NOT NULL COMMENT 'Yorum metni',
  `rating` tinyint(1) DEFAULT 5 COMMENT 'Yıldız puanı (1-5)',
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Varsayılan yorumlar
INSERT INTO `testimonials` (`name`, `role`, `avatar`, `text`, `rating`, `is_active`, `sort_order`) VALUES
('Michael R.', 'Amazon FBA Seller', 'M', 'This tool saved me hours of manual work. I can now analyze competitor stores in minutes instead of days.', 5, 1, 1),
('Sarah L.', 'Product Researcher', 'S', 'The spider crawl feature is amazing! It found products I would have never discovered manually.', 5, 1, 2),
('David K.', 'Dropshipper', 'D', 'Best ASIN scraper I''ve used. Fast, reliable, and the pricing is very fair.', 5, 1, 3)
ON DUPLICATE KEY UPDATE `name` = `name`;

-- --------------------------------------------------------
-- Discount Codes tablosu (İndirim Kodları)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `discount_codes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL COMMENT 'İndirim kodu',
  `discount_type` enum('percent','fixed') NOT NULL DEFAULT 'percent' COMMENT 'Yüzde veya sabit tutar',
  `discount_value` decimal(10,2) NOT NULL COMMENT 'İndirim değeri',
  `min_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'Minimum sipariş tutarı',
  `max_uses` int(11) DEFAULT NULL COMMENT 'Maksimum kullanım (NULL = sınırsız)',
  `used_count` int(11) DEFAULT 0 COMMENT 'Kullanım sayısı',
  `valid_from` datetime DEFAULT NULL COMMENT 'Geçerlilik başlangıcı',
  `valid_until` datetime DEFAULT NULL COMMENT 'Geçerlilik bitişi',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Error Logs tablosu (Hata Takip Sistemi)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `error_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL COMMENT 'Kullanıcı ID (giriş yapmışsa)',
  `user_email` varchar(255) DEFAULT NULL COMMENT 'Kullanıcı email',
  `error_type` varchar(50) NOT NULL COMMENT 'Hata tipi: js_error, api_error, scan_error, network_error',
  `error_message` text NOT NULL COMMENT 'Hata mesajı',
  `error_stack` text DEFAULT NULL COMMENT 'Stack trace',
  `source` varchar(50) NOT NULL COMMENT 'Kaynak: extension, popup, content, background, website',
  `url` text DEFAULT NULL COMMENT 'Hata oluşan URL',
  `browser_info` varchar(255) DEFAULT NULL COMMENT 'Tarayıcı bilgisi',
  `extension_version` varchar(20) DEFAULT NULL COMMENT 'Extension versiyonu',
  `extra_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`extra_data`)) COMMENT 'Ekstra JSON veri',
  `ip_address` varchar(45) DEFAULT NULL,
  `is_resolved` tinyint(1) DEFAULT 0 COMMENT 'Çözüldü mü?',
  `resolved_at` datetime DEFAULT NULL,
  `resolved_by` int(11) DEFAULT NULL COMMENT 'Çözen admin ID',
  `notes` text DEFAULT NULL COMMENT 'Admin notları',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_type` (`error_type`),
  KEY `idx_source` (`source`),
  KEY `idx_created` (`created_at`),
  KEY `idx_resolved` (`is_resolved`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
