/**
 * ASIN Scout Pro - Auth Helper
 * Oturum yönetimi ve token yenileme
 */

const AuthHelper = {
    API_BASE: '/api',
    refreshInterval: null,

    /**
     * Token'ı al (önce localStorage, sonra sessionStorage)
     */
    getToken() {
        return localStorage.getItem('token') || sessionStorage.getItem('token');
    },

    /**
     * Kullanıcı bilgisini al
     */
    getUser() {
        const userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
        try {
            return userStr ? JSON.parse(userStr) : null;
        } catch (e) {
            return null;
        }
    },

    /**
     * "Beni hatırla" seçili mi kontrol et
     */
    isRememberMe() {
        return localStorage.getItem('rememberMe') === 'true';
    },

    /**
     * Doğru storage'ı döndür
     */
    getStorage() {
        return this.isRememberMe() ? localStorage : sessionStorage;
    },

    /**
     * Token ve user'ı kaydet
     */
    saveAuth(token, user, rememberMe = null) {
        // rememberMe null ise mevcut durumu koru
        if (rememberMe === null) {
            rememberMe = this.isRememberMe();
        }

        // Önce tümünü temizle
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');

        // Yeni değerleri kaydet
        localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');

        if (rememberMe) {
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
        } else {
            sessionStorage.setItem('token', token);
            sessionStorage.setItem('user', JSON.stringify(user));
        }
    },

    /**
     * Token'ı güncelle (user değişmeden)
     */
    updateToken(token) {
        const storage = this.getStorage();
        storage.setItem('token', token);
    },

    /**
     * Oturumu kapat
     * @param {string} redirectUrl - Yönlendirilecek URL (varsayılan: /login.html)
     */
    logout(redirectUrl = '/login.html') {
        this.stopTokenRefresh();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('rememberMe');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        window.location.href = redirectUrl;
    },

    /**
     * Token'ı yenile
     */
    async refreshToken() {
        const token = this.getToken();
        if (!token) return false;

        try {
            const resp = await fetch(this.API_BASE + '/auth.php?action=refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ remember_me: this.isRememberMe() })
            });

            const data = await resp.json();

            if (data.success && data.data.token) {
                this.updateToken(data.data.token);
                console.log('[Auth] Token yenilendi');
                return true;
            }
        } catch (e) {
            console.error('[Auth] Token yenileme hatası:', e);
        }
        return false;
    },

    /**
     * Otomatik token yenilemeyi başlat
     * Her 6 saatte bir token yenilenir
     */
    startTokenRefresh() {
        if (this.refreshInterval) return;

        // Sadece "beni hatırla" seçiliyse periyodik yenileme yap
        if (this.isRememberMe()) {
            // Her 6 saatte bir yenile (token 7-30 gün geçerli)
            this.refreshInterval = setInterval(() => {
                this.refreshToken();
            }, 6 * 60 * 60 * 1000); // 6 saat

            // Sayfa yüklendiğinde token 1 günden eskiyse hemen yenile
            this.checkAndRefreshIfNeeded();
        }
    },

    /**
     * Token yenileme interval'ını durdur
     */
    stopTokenRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    },

    /**
     * Token eskiyse yenile
     */
    async checkAndRefreshIfNeeded() {
        const token = this.getToken();
        if (!token) return;

        try {
            // JWT payload'ını decode et
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Math.floor(Date.now() / 1000);
            const timeUntilExpiry = payload.exp - now;

            // 1 günden az kaldıysa yenile
            if (timeUntilExpiry < 86400) {
                console.log('[Auth] Token süresi dolmak üzere, yenileniyor...');
                await this.refreshToken();
            }
        } catch (e) {
            console.error('[Auth] Token kontrol hatası:', e);
        }
    },

    /**
     * Kullanıcı giriş yapmış mı kontrol et
     * Gerekirse login sayfasına yönlendir
     */
    async requireAuth(redirectToLogin = true) {
        const token = this.getToken();

        if (!token) {
            if (redirectToLogin) {
                window.location.href = 'login.html';
            }
            return null;
        }

        try {
            const resp = await fetch(this.API_BASE + '/auth.php?action=profile', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json();

            if (data.success && data.data.user) {
                // Token yenileme başlat
                this.startTokenRefresh();
                return data.data;
            }
        } catch (e) {
            console.error('[Auth] Doğrulama hatası:', e);
        }

        // Token geçersiz
        this.logout();
        return null;
    },

    /**
     * API isteği yap (token otomatik eklenir)
     */
    async fetch(url, options = {}) {
        const token = this.getToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        options.headers = options.headers || {};
        options.headers['Authorization'] = 'Bearer ' + token;

        const resp = await fetch(url, options);
        const data = await resp.json();

        // 401 hatası alırsak logout yap
        if (resp.status === 401) {
            this.logout();
            throw new Error('Session expired');
        }

        return data;
    }
};

// Global erişim için
window.AuthHelper = AuthHelper;
