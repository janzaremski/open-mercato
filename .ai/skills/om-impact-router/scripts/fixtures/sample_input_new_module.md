Create a new module for managing loyalty points and customer rewards programs.

The module should:
- be a separate module with its own entities for loyalty accounts, point transactions, and reward tiers
- provide a new entity and API surface for point balance lookups
- allow customers to earn points on purchases and redeem them for discounts
- be a standalone bounded domain, not an addition to the existing customers module
