<?php
/**
 * Main Web Application Entry Point
 * Automatically verifies database readiness and serves the frontend UI.
 */
require_once __DIR__ . '/db.php';

try {
    Database::getConnection();
} catch (Throwable $e) {
    error_log("Database initialization error: " . $e->getMessage());
}

if (file_exists(__DIR__ . '/index.html')) {
    readfile(__DIR__ . '/index.html');
} else {
    http_response_code(404);
    echo "Frontend entry point index.html not found.";
}
exit;
