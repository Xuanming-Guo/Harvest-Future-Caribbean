# Contracts

This directory is the source of truth for communication between the
application, simulation, and model.

No speculative endpoints or placeholder schemas are created during repository
setup. The first issue that introduces an interface must add its canonical
contract here.

## Contract locations

- [`openapi.yaml`](openapi.yaml): public Product API and internal observable
  simulation/result ingestion.
- [`common.schema.json`](common.schema.json): IDs, quantities, money, location,
  roles, provenance, pagination, and RFC 7807 errors.
- [`events/event-envelope.schema.json`](events/event-envelope.schema.json):
  event envelope and typed payload validation.
- [`events/EVENT_CATALOGUE.md`](events/EVENT_CATALOGUE.md): event purpose and
  deterministic simulation reaction.
- [`simulation/openapi.yaml`](simulation/openapi.yaml): internal FastAPI run,
  command, observable-world, and paired-run service.
- [`model/openapi.yaml`](model/openapi.yaml) and
  [`model/yield-prediction.schema.json`](model/yield-prediction.schema.json):
  internal yield-prediction request/response.

[`docs/api_info.md`](../docs/api_info.md) is the human-readable implementation
map for these machine contracts.

Use OpenAPI 3.1 and JSON Schema so TypeScript and Python consumers can generate
or validate compatible types. Generated types should be derived from these
contracts; do not maintain independent, hand-written copies that can drift.

## Change rules

An interface-changing pull request must:

1. Update the canonical contract.
2. Update affected documentation.
3. Update affected consumers in the same pull request when practical.
4. Link explicit blocking issues when a consumer must follow separately.
5. Describe compatibility or migration impact.

Do not merge competing payload definitions in application, simulation, or model
code. Resolve the contract first.

The Product API is the only gateway for user-visible operational changes.
Neither the simulation nor the model may use a contract as justification to
write directly to Product API storage.
