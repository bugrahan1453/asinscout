<?php
/**
 * ASIN Scout Pro - Bootstrap
 * Tüm API dosyaları bu dosyayı include eder
 */

// Config yükle
$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    die(json_encode(['error' => 'Configuration file not found. Copy config.example.php to config.php']));
}
require_once $configPath;

// Classes
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Api.php';
require_once __DIR__ . '/Mailer.php';

// CORS ayarla
Api::cors();
