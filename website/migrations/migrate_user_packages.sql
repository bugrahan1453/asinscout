-- Migration: Mevcut kullanici paketlerini user_packages tablosuna tasi
-- Bu dosyayi veritabaninda calistirin

-- 1. Oncelikle scans tablosuna user_package_id kolonu ekle (yoksa)
ALTER TABLE `scans` ADD COLUMN IF NOT EXISTS `user_package_id` int(11) DEFAULT NULL COMMENT 'Hangi paketten kullanildi' AFTER `user_id`;

-- 2. user_packages tablosunu olustur (yoksa)
CREATE TABLE IF NOT EXISTS `user_packages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `package_id` int(11) NOT NULL,
  `package_name` varchar(100) NOT NULL COMMENT 'Satin alindigi andaki paket adi',
  `scan_limit` int(11) NOT NULL COMMENT 'Tarama basina max ASIN',
  `daily_scan_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Gunluk tarama hakki',
  `daily_scans_used` int(11) NOT NULL DEFAULT 0 COMMENT 'Bugun bu paketten kullanilan tarama sayisi',
  `last_scan_date` date DEFAULT NULL COMMENT 'Bu paketteki son tarama tarihi',
  `order_id` int(11) DEFAULT NULL COMMENT 'Ilgili siparis',
  `purchased_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_package` (`package_id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Mevcut kullanicilarin paketlerini migrate et
-- Sadece aktif paketi olan kullanicilari al
INSERT INTO user_packages (user_id, package_id, package_name, scan_limit, daily_scan_limit, daily_scans_used, last_scan_date, purchased_at, expires_at, is_active)
SELECT
    u.id as user_id,
    u.package_id,
    COALESCE(p.name, 'Migrated Package') as package_name,
    u.scan_limit,
    COALESCE(p.daily_scan_limit, u.daily_scan_limit, 0) as daily_scan_limit,
    u.daily_scans_used,
    u.last_scan_date,
    u.created_at as purchased_at,
    u.package_expires as expires_at,
    1 as is_active
FROM users u
LEFT JOIN packages p ON u.package_id = p.id
WHERE u.package_id IS NOT NULL
  AND u.package_expires IS NOT NULL
  AND u.package_expires > NOW()
  AND NOT EXISTS (
    SELECT 1 FROM user_packages up
    WHERE up.user_id = u.id AND up.package_id = u.package_id
  );

-- 4. Kontrol sorgusu - migrate edilen kayitlar
SELECT
    up.id,
    up.user_id,
    u.email,
    up.package_name,
    up.scan_limit,
    up.daily_scan_limit,
    up.expires_at,
    up.is_active
FROM user_packages up
JOIN users u ON up.user_id = u.id
ORDER BY up.created_at DESC
LIMIT 20;

-- Migration tamamlandi!
-- Artik yeni paket alimlari otomatik olarak user_packages tablosuna eklenecek
