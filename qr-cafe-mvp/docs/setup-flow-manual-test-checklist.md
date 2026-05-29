# Setup Flow Manual Test Checklist

## Sprint B Data Cases

### Categories deletion
- [ ] 1 category, linked menus 0 -> delete succeeds (no reassign).
- [ ] 2+ categories, linked menus 0 -> delete succeeds.
- [ ] 2+ categories, linked menus 1+ -> reassign then delete succeeds.
- [ ] linked menus 1+ and no target category -> error message shown.

### Bulk mode policy sync
- [ ] Categories bulk mode with existing data -> bulk CTA hidden/blocked and reason shown.
- [ ] Categories bulk mode with no data -> bulk CTA shown and usable.
- [ ] Menu bulk mode with existing data -> bulk CTA hidden/blocked and reason shown.
- [ ] Menu bulk mode with no data -> bulk CTA shown and usable.

### Options bulk unsupported
- [ ] Options bulk mode opens unsupported notice.
- [ ] User can continue with direct mode or go to setup mode change.
