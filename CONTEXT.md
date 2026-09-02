# Toward Us domain context

Toward Us is a **Multi-principal Relationship Agent** for exactly two authenticated principals in one relationship. It helps both people communicate, decide, plan, remember, and follow through without allowing either person to control the shared agent alone.

## Domain language

- **Module**: a cohesive feature boundary such as mediation, relationship graph, decisions, or notifications.
- **Interface**: the small authorized API and projected response contract exposed by a Module.
- **Implementation**: storage, state transition, model call, and UI code hidden behind an Interface.
- **Consent Kernel**: the server authority for visibility, AI access, approval policy, provenance, version, and per-user projection.
- **Relationship Graph**: long-lived objects belonging to one relationship: milestones, lists, issues, agreements, commitments, outcomes, and consent events.
- **Private Agent**: a model path that may use one member's private input and returns only to that member.
- **Shared Agent**: a model path whose context is constructed on the server from jointly permitted objects only.
- **Joint fact**: an object explicitly shared or confirmed under its approval policy; private statements are never joint facts by inference.
- **Seam**: the narrow boundary between the mediation Module and relationship Module. They share identity and membership, not private payloads.
- **Adapter**: local JSON or PostgreSQL storage behind the same Relationship Graph Interface.

The current implementation and status matrix are canonical in [docs/multi-principal-relationship-agent.zh-CN.md](./docs/multi-principal-relationship-agent.zh-CN.md).
