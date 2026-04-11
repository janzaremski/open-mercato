Change how the catalog pricing engine resolves multi-currency prices.

Currently the pipeline uses a fixed priority order. We need to modify the core calculation in the pricing service to support dynamic priority based on customer tier. This requires changing the calculation logic inside the pricing service and modifying the resolve pipeline behavior.
