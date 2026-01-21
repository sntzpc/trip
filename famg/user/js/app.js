// Main Application
class App {
    constructor() {
        this.initialize();
    }

    initialize() {
        console.log('Family Gathering KMP1 2026 App initialized');
        
        // Cek apakah user sudah absen
        this.checkInitialState();
        
        // Event listeners tambahan
        this.addEventListeners();
    }

    checkInitialState() {
        // Jika user sudah login dari session, langsung tampilkan app
        const savedUser = sessionStorage.getItem('currentUser');
        if (savedUser) {
            // User sudah login, aplikasi akan ditampilkan oleh auth module
            console.log('User already logged in');
        }
    }

    addEventListeners() {
        // Mode development: tidak ada shortcut draw/ubah event (semua via operator/admin)
    }
}

// Inisialisasi aplikasi saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
    new App();
});