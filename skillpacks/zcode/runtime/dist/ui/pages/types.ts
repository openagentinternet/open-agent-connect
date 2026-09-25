import type { MetabotUiPageName } from '../../daemon/routes/types';
import type { I18nKey } from '../i18n';

export interface LocalUiPanelDefinition {
  title: string;
  body: string;
  items?: string[];
  actionLabel?: string;
  actionHref?: string;
}

export interface LocalUiPageDefinition {
  page: MetabotUiPageName;
  title: string;
  /**
   * Dictionary key behind `title`. When set, the renderer tags `<title>` with
   * `data-i18n-title` so the shared client i18n script can re-apply
   * `document.title` on a live language switch.
   */
  titleKey?: I18nKey;
  eyebrow: string;
  heading: string;
  description: string;
  panels: LocalUiPanelDefinition[];
  contentHtml?: string;
  script: string;
}
