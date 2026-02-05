<?php
/**
 * Email Helper - SMTP Mail Sending
 * PHPMailer kullanmadan native PHP ile SMTP
 */

class Mailer {
    private $socket;
    private $host;
    private $port;
    private $user;
    private $pass;
    private $from;
    private $fromName;
    private $debug = false;
    
    public function __construct() {
        $this->host = SMTP_HOST;
        $this->port = SMTP_PORT;
        $this->user = SMTP_USER;
        $this->pass = SMTP_PASS;
        $this->from = SMTP_FROM;
        $this->fromName = SMTP_FROM_NAME;
    }
    
    /**
     * Email gönder
     */
    public function send($to, $subject, $body, $isHtml = true) {
        try {
            // SMTP bağlantısı
            $this->socket = @fsockopen(
                ($this->port == 465 ? 'ssl://' : '') . $this->host,
                $this->port,
                $errno,
                $errstr,
                30
            );
            
            if (!$this->socket) {
                throw new Exception("SMTP connection failed: $errstr");
            }
            
            $this->getResponse(); // Welcome message
            
            // EHLO
            $this->sendCommand("EHLO " . gethostname());
            
            // STARTTLS for port 587
            if ($this->port == 587) {
                $this->sendCommand("STARTTLS");
                stream_socket_enable_crypto($this->socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                $this->sendCommand("EHLO " . gethostname());
            }
            
            // AUTH LOGIN
            $this->sendCommand("AUTH LOGIN");
            $this->sendCommand(base64_encode($this->user));
            $this->sendCommand(base64_encode($this->pass));
            
            // MAIL FROM
            $this->sendCommand("MAIL FROM:<{$this->from}>");
            
            // RCPT TO
            $this->sendCommand("RCPT TO:<{$to}>");
            
            // DATA
            $this->sendCommand("DATA");
            
            // Headers
            $headers = "From: {$this->fromName} <{$this->from}>\r\n";
            $headers .= "To: {$to}\r\n";
            $headers .= "Subject: {$subject}\r\n";
            $headers .= "MIME-Version: 1.0\r\n";
            
            if ($isHtml) {
                $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
            } else {
                $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
            }
            
            $headers .= "X-Mailer: ASINScoutPro/1.0\r\n";
            $headers .= "\r\n";
            
            // Body
            $message = $headers . $body . "\r\n.";
            $this->sendCommand($message);
            
            // QUIT
            $this->sendCommand("QUIT");
            
            fclose($this->socket);
            return true;
            
        } catch (Exception $e) {
            if ($this->socket) fclose($this->socket);
            error_log("Mailer Error: " . $e->getMessage());
            return false;
        }
    }
    
    private function sendCommand($command) {
        fwrite($this->socket, $command . "\r\n");
        return $this->getResponse();
    }
    
    private function getResponse() {
        $response = '';
        while ($line = fgets($this->socket, 515)) {
            $response .= $line;
            if (substr($line, 3, 1) == ' ') break;
        }
        if ($this->debug) echo $response . "\n";
        return $response;
    }
    
    /**
     * Hoşgeldin emaili
     */
    public static function sendWelcome($email, $name, $credits) {
        $mailer = new self();
        $subject = "Welcome to " . SITE_NAME . "! 🎉";
        
        $body = self::getTemplate('welcome', [
            'name' => $name,
            'email' => $email,
            'credits' => number_format($credits),
            'site_name' => SITE_NAME,
            'site_url' => SITE_URL,
            'login_url' => SITE_URL . '/login'
        ]);
        
        return $mailer->send($email, $subject, $body);
    }
    
    /**
     * Şifre sıfırlama emaili
     */
    public static function sendPasswordReset($email, $name, $resetToken) {
        $mailer = new self();
        $subject = "Reset Your Password - " . SITE_NAME;
        
        $resetUrl = SITE_URL . "/reset-password?token=" . $resetToken;
        
        $body = self::getTemplate('password_reset', [
            'name' => $name,
            'reset_url' => $resetUrl,
            'site_name' => SITE_NAME,
            'site_url' => SITE_URL
        ]);
        
        return $mailer->send($email, $subject, $body);
    }
    
    /**
     * Satın alma onayı
     */
    public static function sendPurchaseConfirmation($email, $name, $packageName, $credits, $amount) {
        $mailer = new self();
        $subject = "Payment Confirmed - " . number_format($credits) . " Credits Added! ✅";
        
        $body = self::getTemplate('purchase', [
            'name' => $name,
            'package_name' => $packageName,
            'credits' => number_format($credits),
            'amount' => number_format($amount, 2),
            'site_name' => SITE_NAME,
            'site_url' => SITE_URL,
            'dashboard_url' => SITE_URL . '/dashboard'
        ]);
        
        return $mailer->send($email, $subject, $body);
    }
    
    /**
     * Düşük kredi uyarısı
     */
    public static function sendLowCreditsWarning($email, $name, $remainingCredits) {
        $mailer = new self();
        $subject = "Low Credits Warning ⚠️ - " . SITE_NAME;
        
        $body = self::getTemplate('low_credits', [
            'name' => $name,
            'credits' => number_format($remainingCredits),
            'site_name' => SITE_NAME,
            'pricing_url' => SITE_URL . '/pricing'
        ]);
        
        return $mailer->send($email, $subject, $body);
    }
    
    /**
     * Email template'leri
     */
    private static function getTemplate($name, $vars) {
        $templates = [
            'welcome' => '
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
<div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #ff6b2c, #ff2c6b); padding: 30px; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 28px;">Welcome to {{site_name}}! 🎉</h1>
    </div>
    <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333;">Hi <strong>{{name}}</strong>,</p>
        <p style="font-size: 16px; color: #555; line-height: 1.6;">
            Thank you for joining {{site_name}}! Your account has been created successfully.
        </p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; color: #666; font-size: 14px;">Your Free Credits</p>
            <p style="margin: 10px 0 0; font-size: 36px; font-weight: bold; color: #22c97a;">{{credits}}</p>
        </div>
        <p style="font-size: 16px; color: #555; line-height: 1.6;">
            You can start scanning Amazon stores right away! Install our Chrome extension and begin extracting ASINs.
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{login_url}}" style="background: linear-gradient(135deg, #ff6b2c, #ff2c6b); color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Get Started</a>
        </div>
        <p style="font-size: 14px; color: #888;">
            Need help? Just reply to this email and we\'ll assist you.
        </p>
    </div>
    <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; font-size: 12px; color: #888;">© 2025 {{site_name}}. All rights reserved.</p>
    </div>
</div>
</body>
</html>',

            'password_reset' => '
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
<div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #ff6b2c, #ff2c6b); padding: 30px; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">Reset Your Password 🔐</h1>
    </div>
    <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333;">Hi <strong>{{name}}</strong>,</p>
        <p style="font-size: 16px; color: #555; line-height: 1.6;">
            We received a request to reset your password. Click the button below to create a new password:
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{reset_url}}" style="background: linear-gradient(135deg, #ff6b2c, #ff2c6b); color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Reset Password</a>
        </div>
        <p style="font-size: 14px; color: #888; line-height: 1.6;">
            This link will expire in 1 hour. If you didn\'t request this, you can safely ignore this email.
        </p>
        <p style="font-size: 12px; color: #aaa; margin-top: 20px; word-break: break-all;">
            Or copy this link: {{reset_url}}
        </p>
    </div>
    <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; font-size: 12px; color: #888;">© 2025 {{site_name}}. All rights reserved.</p>
    </div>
</div>
</body>
</html>',

            'purchase' => '
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
<div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #22c97a, #17a566); padding: 30px; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">Payment Confirmed! ✅</h1>
    </div>
    <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333;">Hi <strong>{{name}}</strong>,</p>
        <p style="font-size: 16px; color: #555; line-height: 1.6;">
            Thank you for your purchase! Your credits have been added to your account.
        </p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 10px 0; color: #666;">Package:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #333;">{{package_name}}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #666;">Credits Added:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #22c97a;">{{credits}}</td>
                </tr>
                <tr style="border-top: 1px solid #eee;">
                    <td style="padding: 10px 0; color: #666;">Amount Paid:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #333;">${{amount}}</td>
                </tr>
            </table>
        </div>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{dashboard_url}}" style="background: linear-gradient(135deg, #ff6b2c, #ff2c6b); color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Go to Dashboard</a>
        </div>
    </div>
    <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; font-size: 12px; color: #888;">© 2025 {{site_name}}. All rights reserved.</p>
    </div>
</div>
</body>
</html>',

            'low_credits' => '
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
<div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #ff9500, #ff6b00); padding: 30px; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">Low Credits Warning ⚠️</h1>
    </div>
    <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333;">Hi <strong>{{name}}</strong>,</p>
        <p style="font-size: 16px; color: #555; line-height: 1.6;">
            Your credit balance is running low. You have <strong style="color: #ff6b00;">{{credits}}</strong> credits remaining.
        </p>
        <p style="font-size: 16px; color: #555; line-height: 1.6;">
            To continue scanning Amazon stores without interruption, please consider purchasing more credits.
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{pricing_url}}" style="background: linear-gradient(135deg, #ff6b2c, #ff2c6b); color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Buy More Credits</a>
        </div>
    </div>
    <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; font-size: 12px; color: #888;">© 2025 {{site_name}}. All rights reserved.</p>
    </div>
</div>
</body>
</html>'
        ];
        
        $template = $templates[$name] ?? '';
        
        foreach ($vars as $key => $value) {
            $template = str_replace('{{' . $key . '}}', htmlspecialchars($value), $template);
        }
        
        return $template;
    }
}
