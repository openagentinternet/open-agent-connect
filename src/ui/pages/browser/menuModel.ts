export interface BrowserMenuItemDefinition {
  id: string;
  label: string;
  icon: string;
  action: 'open-settings';
  settingsTab: 'baseUrls' | 'cache';
}

export interface BrowserMenuSectionDefinition {
  id: string;
  items: BrowserMenuItemDefinition[];
}

export interface BrowserSettingsTabDefinition {
  id: 'baseUrls' | 'cache';
  label: string;
}

export interface BrowserBaseUrlFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
}

export const BROWSER_MENU_SECTIONS: BrowserMenuSectionDefinition[] = [
  {
    id: 'main',
    items: [
      {
        id: 'settings',
        label: 'Settings',
        icon: 'settings',
        action: 'open-settings',
        settingsTab: 'baseUrls',
      },
      {
        id: 'cache',
        label: 'Cache Management',
        icon: 'database',
        action: 'open-settings',
        settingsTab: 'cache',
      },
    ],
  },
];

export const BROWSER_SETTINGS_TABS: BrowserSettingsTabDefinition[] = [
  { id: 'baseUrls', label: 'Base URLs' },
  { id: 'cache', label: 'Cache' },
];

export const BROWSER_BASE_URL_FIELDS: BrowserBaseUrlFieldDefinition[] = [
  {
    key: 'metasoP2PBaseUrl',
    label: 'Metaso P2P Base URL',
    placeholder: 'https://so.metaid.io',
  },
  {
    key: 'metafileContentBaseUrl',
    label: 'Metafile Content Base URL',
    placeholder: 'https://so.metaid.io/content',
  },
  {
    key: 'manApiBaseUrl',
    label: 'ManAPI Base URL',
    placeholder: 'https://manapi.metaid.io',
  },
  {
    key: 'blockExplorerBaseUrl',
    label: 'Block Explorer Base URL',
    placeholder: 'https://www.mvcscan.com/tx',
  },
  {
    key: 'walletApiBaseUrl',
    label: 'Wallet API Base URL',
    placeholder: 'https://...',
  },
];
