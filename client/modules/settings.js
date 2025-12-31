import { state } from './state.js';
import { elements } from './ui.js';
import { sendWsMessage } from './socket.js';

export function setupSettingsListeners() {
    if (elements.roomSettingsBtn) {
        elements.roomSettingsBtn.addEventListener('click', () => {
            elements.roomSettingsModal.classList.remove('hidden');
        });
    }

    if (elements.closeRoomSettings) {
        elements.closeRoomSettings.addEventListener('click', () => {
            elements.roomSettingsModal.classList.add('hidden');
        });
    }

    // Close on backdrop click
    if (elements.roomSettingsModal) {
        elements.roomSettingsModal.addEventListener('click', (e) => {
            if (e.target === elements.roomSettingsModal || e.target.classList.contains('modal-backdrop')) {
                elements.roomSettingsModal.classList.add('hidden');
            }
        });
    }

    if (elements.settingFreeMode) {
        elements.settingFreeMode.addEventListener('change', (e) => {
            if (!state.isHost) {
                // Should not happen as modal hidden for non-host
                e.target.checked = state.roomSettings.freeMode;
                return;
            }
            const freeMode = e.target.checked;
            sendWsMessage({
                type: 'update-settings',
                settings: { freeMode }
            });
        });
    }
}

export function updateSettingsUI(settings) {
    if (!settings) return;
    state.roomSettings = { ...state.roomSettings, ...settings };

    // Update Toggle UI
    if (elements.settingFreeMode) {
        elements.settingFreeMode.checked = state.roomSettings.freeMode;
    }

    // Disable inputs if not host? 
    // Actually the modal button handles visibility.
    // But if we want to show settings to viewers as read-only, we should disable the input.
    if (elements.settingFreeMode) {
        elements.settingFreeMode.disabled = !state.isHost;
    }

    // Update UI Badges or Toasts if needed
    // e.g. Show "Free Mode Active" somewhere
}

export function toggleSettingsButton(isHost) {
    if (elements.roomSettingsBtn) {
        if (isHost) {
            elements.roomSettingsBtn.classList.remove('hidden');
        } else {
            elements.roomSettingsBtn.classList.add('hidden');
        }
    }
}
