
import { elements } from './dom.js';

// Default settings
const DEFAULT_SETTINGS = {
    size: '1em',
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.75)'
};

export const captionSettings = {
    settings: { ...DEFAULT_SETTINGS },

    // Load from local storage
    load() {
        try {
            const stored = localStorage.getItem('captionSettings');
            if (stored) {
                this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
            }
        } catch (e) {
            console.error('Failed to load caption settings:', e);
        }
        this.apply();
    },

    // Save to local storage
    save() {
        try {
            localStorage.setItem('captionSettings', JSON.stringify(this.settings));
        } catch (e) {
            console.error('Failed to save caption settings:', e);
        }
    },

    // Apply CSS variables
    apply() {
        const root = document.documentElement;
        root.style.setProperty('--cue-size', this.settings.size);
        root.style.setProperty('--cue-color', this.settings.color);
        root.style.setProperty('--cue-bg', this.settings.bg);

        // Also update preview vars
        root.style.setProperty('--preview-size', this.settings.size);
        root.style.setProperty('--preview-color', this.settings.color);
        root.style.setProperty('--preview-bg', this.settings.bg);
    },

    update(key, value) {
        this.settings[key] = value;
        this.apply();
    },

    initUI() {
        const modal = document.getElementById('caption-settings-modal');
        const openBtn = document.getElementById('caption-settings-btn');
        const doneBtn = document.getElementById('save-caption-settings');
        const backdrop = modal?.querySelector('.modal-backdrop');

        if (!modal || !openBtn) return;

        // Open Modal
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent closing parent menu
            modal.classList.remove('hidden');
            this.syncUI();
            // Close parent menu if open
            if (elements.captionMenu) elements.captionMenu.classList.add('hidden');
        });

        // Close Modal
        const close = () => {
            modal.classList.add('hidden');
            this.save(); // Save on close
        };

        doneBtn.addEventListener('click', close);
        backdrop.addEventListener('click', close);

        // Setup Size Toggles
        const sizeBtns = document.querySelectorAll('#setting-size button');
        sizeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sizeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.update('size', btn.dataset.value);
            });
        });

        // Setup Color Buttons
        const colorBtns = document.querySelectorAll('#setting-color button');
        colorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                colorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.update('color', btn.dataset.value);
            });
        });

        // Setup BG Toggles
        const bgBtns = document.querySelectorAll('#setting-bg button');
        bgBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                bgBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.update('bg', btn.dataset.value);
            });
        });
    },

    // Sync UI state with current settings
    syncUI() {
        // Size
        document.querySelectorAll('#setting-size button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === this.settings.size);
        });

        // Color
        document.querySelectorAll('#setting-color button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === this.settings.color);
        });

        // BG
        document.querySelectorAll('#setting-bg button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === this.settings.bg);
        });
    }
};
