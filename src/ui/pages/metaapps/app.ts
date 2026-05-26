import type { LocalUiPageDefinition } from '../types';

export function buildMetaAppsPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'metaapps',
    title: 'MetaApps',
    eyebrow: 'MetaApps',
    heading: 'MetaApps',
    description: 'Local MetaApp gallery entry point.',
    panels: [],
    contentHtml: `
      <section class="metaapps-shell" data-metaapps-shell>
        <header class="metaapps-header">
          <div>
            <span class="metaapps-kicker">Gallery</span>
            <h1>MetaApps</h1>
          </div>
        </header>
        <section class="metaapps-placeholder" aria-label="MetaApps">
          <h2>Gallery shell</h2>
          <p>Published MetaApp views open here while the full gallery workspace is prepared.</p>
        </section>
      </section>
    `,
    script: '',
  };
}
