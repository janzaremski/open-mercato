Add a new ACL feature to the catalog module that restricts access to the variant management UI.

The new permission should:
- be declared as catalog.manage_variants in acl.ts
- be added to the admin and superadmin default role features in setup.ts
- gate the variant editing pages in the backend
