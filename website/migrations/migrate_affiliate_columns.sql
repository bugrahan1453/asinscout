-- Migration: Affiliate sistemi icin eksik kolonlari ekle
-- Bu dosyayi veritabaninda calistirin
-- Tarih: 2026-02-12

-- 1. Users tablosuna referred_by kolonu ekle
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `referred_by` int(11) DEFAULT NULL COMMENT 'Affiliate ID';

-- 2. Orders tablosuna affiliate ve indirim kolonlari ekle
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `affiliate_id` int(11) DEFAULT NULL COMMENT 'Affiliate ID';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `discount_code` varchar(50) DEFAULT NULL COMMENT 'Kullanilan indirim kodu';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `discount_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'Indirim tutari';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `original_amount` decimal(10,2) DEFAULT NULL COMMENT 'Indirim oncesi tutar';

-- 3. Affiliates tablosuna user_discount kolonu ekle
ALTER TABLE `affiliates` ADD COLUMN IF NOT EXISTS `user_discount` decimal(5,2) NOT NULL DEFAULT 0.00 COMMENT 'Kullanici indirim orani (%)';

-- 4. Index ekle (performans icin)
-- Eger index yoksa ekle, varsa hata verir ama sorun olmaz
ALTER TABLE `orders` ADD INDEX IF NOT EXISTS `idx_affiliate` (`affiliate_id`);

-- Kontrol sorgusu - kolonlarin eklendigini dogrula
SELECT
    'users.referred_by' as kolon,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'referred_by'
    ) THEN 'OK' ELSE 'EKSIK' END as durum
UNION ALL
SELECT
    'orders.affiliate_id',
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'affiliate_id'
    ) THEN 'OK' ELSE 'EKSIK' END
UNION ALL
SELECT
    'orders.discount_code',
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'discount_code'
    ) THEN 'OK' ELSE 'EKSIK' END
UNION ALL
SELECT
    'orders.discount_amount',
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'discount_amount'
    ) THEN 'OK' ELSE 'EKSIK' END
UNION ALL
SELECT
    'orders.original_amount',
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'original_amount'
    ) THEN 'OK' ELSE 'EKSIK' END
UNION ALL
SELECT
    'affiliates.user_discount',
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'affiliates' AND column_name = 'user_discount'
    ) THEN 'OK' ELSE 'EKSIK' END;

-- Migration tamamlandi!
