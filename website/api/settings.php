<?php
/**
 * ASIN Scout Pro - Public Settings API
 */

require_once __DIR__ . '/../includes/bootstrap.php';

$action = $_GET['action'] ?? '';
$db = Database::getInstance();

switch ($action) {

    case 'public':
        // Public settings that can be accessed without authentication
        $publicKeys = [
            'extension_url',
            'chrome_store_url',
            'extension_version',
            'user_guide_tr',
            'user_guide_en'
        ];

        $settings = $db->fetchAll(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('" . implode("','", $publicKeys) . "')"
        ) ?: [];

        $result = [];
        foreach ($settings as $s) {
            $result[$s['setting_key']] = $s['setting_value'];
        }

        Api::success($result);
        break;

    default:
        Api::error('Invalid action', 400);
}
