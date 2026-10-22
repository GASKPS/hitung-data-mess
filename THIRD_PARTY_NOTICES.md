# Third-party notices

The production application vendors these runtime libraries so that Excel parsing and Supabase integration do not depend on an external script CDN at runtime.

| Asset | Version | License | Source |
| --- | --- | --- | --- |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | https://cdn.jsdelivr.net/npm/@e965/xlsx@0.20.3/xlsx.mjs (mirror of SheetJS CE distribution) |
| supabase-js UMD | 2.118.0 | MIT | https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js |
| DM Sans | Google Fonts distribution | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/dmsans |
| Manrope | Google Fonts distribution | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/manrope |

License texts are included in `dist/assets/licenses/`. Supabase's bundled dependencies retain their own license notices. Icons and application mark are inline SVG authored for this project.

Development dependencies jsdom (MIT) and PGlite (Apache-2.0) are recorded in package-lock.json and are not included in the deployed static assets.
