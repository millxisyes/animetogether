// Feature Flags System
const FEATURE_FLAG_MAPPINGS = {
    'hianimedev': { flag: 'hianime', name: 'HiAnime Fallback' }
};

export const featureFlags = {
    // Load feature flags from localStorage
    load() {
        try {
            const stored = localStorage.getItem('featureFlags');
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.error('Failed to load feature flags:', e);
            return {};
        }
    },

    // Save feature flags to localStorage
    save(flags) {
        try {
            localStorage.setItem('featureFlags', JSON.stringify(flags));
        } catch (e) {
            console.error('Failed to save feature flags:', e);
        }
    },

    // Check if a feature flag is enabled
    isEnabled(flag) {
        if (flag === 'hianime') return true; // Forced enabled per request
        const flags = this.load();
        return flags[flag] === true;
    },

    // Enable a feature flag
    enable(flag) {
        const flags = this.load();
        flags[flag] = true;
        this.save(flags);
    },

    // Disable a feature flag
    disable(flag) {
        const flags = this.load();
        flags[flag] = false;
        this.save(flags);
    },

    // Toggle a feature flag
    toggle(flag) {
        if (this.isEnabled(flag)) {
            this.disable(flag);
            return false;
        } else {
            this.enable(flag);
            return true;
        }
    }
};

export function checkFeatureFlagCustomId(discordSdk) {
    // customId is available on discordSdk after ready()
    const customId = discordSdk.customId;

    if (!customId) {
        return false;
    }

    console.log('Discord SDK customId detected:', customId);

    // Check if the customId matches any feature flag mapping
    const config = FEATURE_FLAG_MAPPINGS[customId];
    if (config) {
        const isCurrentlyEnabled = featureFlags.isEnabled(config.flag);
        showFeatureFlagDialog(config.flag, config.name, isCurrentlyEnabled);
        return true;
    }

    return false;
}

// Show feature flag toggle dialog
function showFeatureFlagDialog(flag, flagName, isCurrentlyEnabled) {
    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'modal feature-flag-modal';
    modal.id = 'feature-flag-modal';

    const action = isCurrentlyEnabled ? 'Disable' : 'Enable';
    const description = isCurrentlyEnabled
        ? `The <strong>${flagName}</strong> feature is currently enabled. Would you like to disable it?`
        : `Would you like to enable the <strong>${flagName}</strong> feature?`;

    modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card feature-flag-card">
      <div class="modal-header">
        <h3>${action} Feature Flag</h3>
      </div>
      <div class="modal-body">
        <p>${description}</p>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="feature-flag-no">No</button>
        <button class="primary-btn" id="feature-flag-yes">Yes</button>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    // Handle Yes button
    document.getElementById('feature-flag-yes').addEventListener('click', () => {
        featureFlags.toggle(flag);
        const nowEnabled = featureFlags.isEnabled(flag);
        showFeatureFlagConfirmation(flagName, nowEnabled);
        modal.remove();
    });

    // Handle No button
    document.getElementById('feature-flag-no').addEventListener('click', () => {
        modal.remove();
    });

    // Handle backdrop click
    modal.querySelector('.modal-backdrop').addEventListener('click', () => {
        modal.remove();
    });
}

// Show confirmation after toggling feature flag
function showFeatureFlagConfirmation(flagName, isEnabled) {
    const modal = document.createElement('div');
    modal.className = 'modal feature-flag-modal';
    modal.id = 'feature-flag-confirmation';

    const status = isEnabled ? 'enabled' : 'disabled';

    modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card feature-flag-card">
      <div class="modal-header">
        <h3>Feature Flag Updated</h3>
      </div>
      <div class="modal-body">
        <p><strong>${flagName}</strong> has been ${status}.</p>
        <p class="muted-text">This setting will persist across sessions.</p>
      </div>
      <div class="modal-actions">
        <button class="primary-btn" id="feature-flag-ok">OK</button>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    document.getElementById('feature-flag-ok').addEventListener('click', () => {
        modal.remove();
    });

    modal.querySelector('.modal-backdrop').addEventListener('click', () => {
        modal.remove();
    });
}
