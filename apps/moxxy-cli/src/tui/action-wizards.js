export function createVaultSetWizard() {
  return {
    flow: 'vault-set',
    step: 'key',
    values: {},
  };
}

export function createVaultRemoveWizard() {
  return {
    flow: 'vault-remove',
    step: 'key',
    values: {},
  };
}

export function buildVaultRemovePickerItems(secrets) {
  return (Array.isArray(secrets) ? secrets : []).map(secret => ({
    label: secret.key_name || secret.backend_key || secret.id || 'unknown',
    description: [
      secret.backend_key ? `backend=${secret.backend_key}` : null,
      secret.policy_label ? `[${secret.policy_label}]` : null,
    ].filter(Boolean).join(' '),
    command: `/vault remove ${secret.key_name}`,
  }));
}

export function createTemplateAssignWizard() {
  return {
    flow: 'template-assign',
    step: 'slug',
    values: {},
  };
}

export function getActionWizardPrompt(wizard) {
  switch (wizard.flow) {
    case 'vault-set':
      return wizard.step === 'key'
        ? {
            title: 'Set Vault Secret',
            label: 'Secret Key',
            placeholder: 'OPENAI_API_KEY',
          }
        : {
            title: 'Set Vault Secret',
            label: 'Secret Value',
            placeholder: 'sk-...',
          };
    case 'vault-remove':
      return {
        title: 'Remove Vault Secret',
        label: 'Secret Key',
        placeholder: 'OPENAI_API_KEY',
      };
    case 'template-assign':
      return {
        title: 'Assign Template',
        label: 'Template Slug',
        placeholder: 'builder',
      };
    default:
      return {
        title: 'Input',
        label: 'Value',
        placeholder: '',
      };
  }
}

export function submitActionWizardValue(wizard, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return {
      done: false,
      wizard,
      error: 'Value cannot be empty.',
    };
  }

  if (wizard.flow === 'vault-set' && wizard.step === 'key') {
    return {
      done: false,
      wizard: {
        ...wizard,
        step: 'value',
        values: { ...wizard.values, key_name: value },
      },
      error: null,
    };
  }

  if (wizard.flow === 'vault-set' && wizard.step === 'value') {
    return {
      done: true,
      payload: {
        key_name: wizard.values.key_name,
        backend_key: wizard.values.key_name,
        value,
      },
      error: null,
    };
  }

  if (wizard.flow === 'vault-remove') {
    return {
      done: true,
      payload: {
        key_name: value,
      },
      error: null,
    };
  }

  if (wizard.flow === 'template-assign') {
    return {
      done: true,
      payload: {
        slug: value,
      },
      error: null,
    };
  }

  return {
    done: false,
    wizard,
    error: 'Unsupported wizard flow.',
  };
}
