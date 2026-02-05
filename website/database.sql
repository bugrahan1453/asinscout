-- ASIN Scout Pro - Database Setup
-- Bu SQL'i phpMyAdmin'de çalıştırın

-- Packages tablosu
CREATE TABLE IF NOT EXISTS `packages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `scan_limit` int(11) NOT NULL DEFAULT 20000,
  `duration_days` int(11) NOT NULL DEFAULT 30,
  `price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `currency` varchar(10) NOT NULL DEFAULT 'USD',
  `description` text,
  `features` text,
  `is_popular` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Users tablosu
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `status` enum('active','suspended','pending') NOT NULL DEFAULT 'active',
  `package_id` int(11) DEFAULT NULL,
  `scan_limit` int(11) NOT NULL DEFAULT 0,
  `package_expires` datetime DEFAULT NULL,
  `total_scans` int(11) NOT NULL DEFAULT 0,
  `total_asins` int(11) NOT NULL DEFAULT 0,
  `email_verified` tinyint(1) NOT NULL DEFAULT 0,
  `verify_token` varchar(100) DEFAULT NULL,
  `reset_token` varchar(100) DEFAULT NULL,
  `reset_expires` datetime DEFAULT NULL,
  `last_login` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `package_id` (`package_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Scans tablosu
CREATE TABLE IF NOT EXISTS `scans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `store_name` varchar(255) DEFAULT NULL,
  `store_url` text,
  `marketplace` varchar(20) DEFAULT NULL,
  `asin_count` int(11) NOT NULL DEFAULT 0,
  `asins` longtext,
  `status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  `scan_type` varchar(50) DEFAULT NULL,
  `duration_seconds` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Orders tablosu
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `package_id` int(11) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(10) NOT NULL DEFAULT 'USD',
  `status` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
  `payment_method` varchar(50) DEFAULT 'stripe',
  `payment_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `package_id` (`package_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Settings tablosu
CREATE TABLE IF NOT EXISTS `settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  `setting_type` varchar(50) DEFAULT 'text',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin kullanıcısı oluştur (şifre: admin123 - değiştirin!)
INSERT INTO `users` (`email`, `password`, `name`, `role`, `status`) VALUES
('admin@asinscout.com', '$2y$10$8K1p/a0dL1LXMw0HvTIVu.QJmLQl0JXJjZxF0Q5H1V6oH7VPNxQyy', 'Admin', 'admin', 'active')
ON DUPLICATE KEY UPDATE `role` = 'admin';

-- Örnek paketler
INSERT INTO `packages` (`name`, `slug`, `scan_limit`, `duration_days`, `price`, `is_popular`, `is_active`, `sort_order`) VALUES
('Starter', 'starter', 20000, 30, 9.99, 0, 1, 1),
('Pro', 'pro', 50000, 30, 19.99, 1, 1, 2),
('Business', 'business', 100000, 30, 34.99, 0, 1, 3)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
