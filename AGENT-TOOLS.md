<!-- GENERATED FILE — do not edit. Run: npm run tools:generate -->
# The Gardener — tool reference

Your one write tool is `npm run propose`. It records a proposal: `{ "summary": "…", "operations": [ … ] }`. Each operation is one of the objects below — copy the example, change the values, keep the `type` key.

### `profile.update`

| Field | Type | Required | Description |
|---|---|---|---|
| `windowDistance` | `on-sill` \| `within-1m` \| `1-to-2m` \| `2-to-3m` \| `over-3m` \| `outdoors` \| null | optional |  |
| `growLight` | boolean \| null | optional |  |
| `potType` | `terracotta` \| `unglazed-ceramic` \| `glazed-ceramic` \| `plastic` \| `porcelain` \| `metal` \| `concrete` \| `fabric` \| `other` \| null | optional |  |
| `potSizeCm` | integer (0, ∞] \| null | optional | Pot RIM DIAMETER in centimetres — rim-to-rim across the top, never the radius and never the height. The engine’s crowding index is height ÷ this diameter. |
| `hasDrainage` | boolean \| null | optional |  |
| `soilMix` | `aroid` \| `all-purpose` \| `all-purpose-perlite` \| `cactus-succulent` \| `orchid-bark` \| `peat-based` \| `coco-coir` \| `semi-hydro` \| `other` \| null | optional |  |
| `growthHabit` | `upright` \| `climber` \| `trailing` \| `clumping` \| `rosette` \| `tree` \| `shrub` \| `other` \| null | optional |  |
| `ageMonths` | integer [0, ∞] \| null | optional | The plant’s AGE in months (not its height, and not how long it has been tracked). |
| `nearHeater` | boolean \| null | optional |  |
| `plantId` | string | optional |  |

```json
{
  "type": "profile.update",
  "plantId": "PLANT_ID",
  "potType": "terracotta"
}
```

### `plant.update`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |
| `nickname` | string \| null | optional |
| `placeId` | string | optional |

```json
{
  "type": "plant.update",
  "plantId": "PLANT_ID",
  "placeId": "PLACE_ID"
}
```

### `progress.create`

| Field | Type | Required | Description |
|---|---|---|---|
| `plantId` | string | optional |  |
| `health` | `SICK` \| `POOR` \| `GOOD` \| `EXCELLENT` | required |  |
| `occurredOn` | string | optional |  |
| `observations` | string \| null | optional |  |
| `sizeCm` | integer (0, 2147483647] \| null | optional | The plant’s HEIGHT in centimetres at the time of this entry. This is the ONLY height the care engine reads — a height written into `observations` is invisible to it and will not affect any schedule. Record it here whenever you know it. |
| `tags` | array of `NEW_LEAF` \| `FLOWERING` \| `SEEDLING` \| `LARGE_LEAVES` \| `NEW_SHOOTS` \| `BLOOM_COMPLETED` \| `FALLEN_LEAF` \| `DROOPING` \| `DRY_LEAVES` \| `YELLOWING_LEAVES` \| `NOT_GROWING` \| `STUNTED_GROWTH` \| `LEANING` \| `PESTS` \| `FUNGUS` \| `SPOTS` \| `DISCOLORATION` | optional |  |

```json
{
  "type": "progress.create",
  "plantId": "PLANT_ID",
  "health": "GOOD",
  "occurredOn": "2026-07-20",
  "observations": "Moved to the east window."
}
```

### `progress.update`

| Field | Type | Required | Description |
|---|---|---|---|
| `plantId` | string | optional |  |
| `entryId` | string | required |  |
| `health` | `SICK` \| `POOR` \| `GOOD` \| `EXCELLENT` | optional |  |
| `occurredOn` | string | optional |  |
| `observations` | string \| null | optional |  |
| `sizeCm` | integer (0, 2147483647] \| null | optional | The plant’s HEIGHT in centimetres at the time of this entry. This is the ONLY height the care engine reads — a height written into `observations` is invisible to it and will not affect any schedule. Record it here whenever you know it. |
| `tags` | array of `NEW_LEAF` \| `FLOWERING` \| `SEEDLING` \| `LARGE_LEAVES` \| `NEW_SHOOTS` \| `BLOOM_COMPLETED` \| `FALLEN_LEAF` \| `DROOPING` \| `DRY_LEAVES` \| `YELLOWING_LEAVES` \| `NOT_GROWING` \| `STUNTED_GROWTH` \| `LEANING` \| `PESTS` \| `FUNGUS` \| `SPOTS` \| `DISCOLORATION` | optional |  |

```json
{
  "type": "progress.update",
  "plantId": "PLANT_ID",
  "entryId": "ENTRY_ID",
  "health": "EXCELLENT"
}
```

### `frequency.set`

| Field | Type | Required | Description |
|---|---|---|---|
| `plantId` | string | optional |  |
| `task` | `WATER` \| `FERTILIZE` \| `REPOT` \| `ROTATE` \| `CLEAN_LEAVES` \| `MIST` | required |  |
| `intervalDays` | integer [1, 3650] | required | The number of DAYS between consecutive occurrences of this task — a cadence, never a date. Setting it overrides the engine’s computed interval for this plant until `frequency.clear`. |

```json
{
  "type": "frequency.set",
  "plantId": "PLANT_ID",
  "task": "WATER",
  "intervalDays": 9
}
```

### `frequency.clear`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |
| `task` | `WATER` \| `FERTILIZE` \| `REPOT` \| `ROTATE` \| `CLEAN_LEAVES` \| `MIST` | required |

```json
{
  "type": "frequency.clear",
  "plantId": "PLANT_ID",
  "task": "WATER"
}
```

### `care.done`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |
| `task` | `WATER` \| `FERTILIZE` \| `REPOT` \| `ROTATE` \| `CLEAN_LEAVES` \| `MIST` | required |
| `occurredOn` | string | required |

```json
{
  "type": "care.done",
  "plantId": "PLANT_ID",
  "task": "WATER",
  "occurredOn": "2026-07-20"
}
```

### `note.create`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |
| `body` | string | required |

```json
{
  "type": "note.create",
  "plantId": "PLANT_ID",
  "body": "Moved this one to the shaded corner today."
}
```

### `place.create`

| Field | Type | Required |
|---|---|---|
| `cityId` | string | required |
| `name` | string | required |
| `indoor` | boolean | required |
| `lightType` | `DIRECT` \| `BRIGHT_INDIRECT` \| `MEDIUM` \| `LOW` | required |
| `climateControlled` | boolean | optional |
| `humidityCharacter` | `DRY` \| `NORMAL` \| `HUMID` | optional |
| `indoorTempMinC` | number | optional |
| `indoorTempMaxC` | number | optional |
| `airflow` | `still` \| `some` \| `breezy` | optional |

```json
{
  "type": "place.create",
  "cityId": "CITY_ID",
  "name": "Study window",
  "indoor": true,
  "lightType": "BRIGHT_INDIRECT",
  "airflow": "some"
}
```

### `place.update`

| Field | Type | Required |
|---|---|---|
| `placeId` | string | required |
| `name` | string | optional |
| `climateControlled` | boolean | optional |
| `lightType` | `DIRECT` \| `BRIGHT_INDIRECT` \| `MEDIUM` \| `LOW` | optional |
| `humidityCharacter` | `DRY` \| `NORMAL` \| `HUMID` \| null | optional |
| `airflow` | `still` \| `some` \| `breezy` \| null | optional |
| `indoorTempMinC` | number \| null | optional |
| `indoorTempMaxC` | number \| null | optional |

```json
{
  "type": "place.update",
  "placeId": "PLACE_ID",
  "airflow": "breezy"
}
```

### `city.create`

| Field | Type | Required |
|---|---|---|
| `name` | string | required |
| `latitude` | number [-90, 90] | required |
| `longitude` | number [-180, 180] | required |
| `timezone` | string | required |

```json
{
  "type": "city.create",
  "name": "Guadalajara",
  "latitude": 20.67,
  "longitude": -103.35,
  "timezone": "America/Mexico_City"
}
```

### `city.update`

| Field | Type | Required |
|---|---|---|
| `cityId` | string | required |
| `name` | string | optional |
| `latitude` | number [-90, 90] | optional |
| `longitude` | number [-180, 180] | optional |
| `timezone` | string | optional |

```json
{
  "type": "city.update",
  "cityId": "CITY_ID",
  "timezone": "America/Mexico_City"
}
```

### `plant.create`

| Field | Type | Required |
|---|---|---|
| `speciesSlug` | string | required |
| `placeId` | string | required |
| `nickname` | string \| null | optional |
| `acquiredOn` | string | required |

```json
{
  "type": "plant.create",
  "speciesSlug": "ficus-lyrata",
  "placeId": "PLACE_ID",
  "acquiredOn": "2026-07-20",
  "nickname": "Figaro"
}
```

### `plant.memorialize`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |

```json
{
  "type": "plant.memorialize",
  "plantId": "PLANT_ID"
}
```

### `plant.gift`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |

```json
{
  "type": "plant.gift",
  "plantId": "PLANT_ID"
}
```

### `substrate.refresh`

| Field | Type | Required |
|---|---|---|
| `plantId` | string | optional |
| `refreshedOn` | string | required |
| `charged` | boolean | optional |

```json
{
  "type": "substrate.refresh",
  "plantId": "PLANT_ID",
  "refreshedOn": "2026-07-20"
}
```

### Cross-field invariants

- **proposal:** profile.update / plant.update / progress.update / place.update / city.update must each change at least one field (an op carrying only its type + target id is rejected).

### Rules enforced outside the schema

- One operation per target — two ops touching the same field, entry, place, city or task are rejected.
- Dates are calendar dates `YYYY-MM-DD`, never ISO instants.
- `null` clears a nullable field; `[]` clears `tags`; a proposal carries 1–10 operations.
- A place edit RECOMPUTES the care plan for EVERY plant living in that place — the owner is shown how many, and you must say so in your summary too.
- There is no operation that deletes a plant, a place or a city (they do not exist, for anybody), and you cannot delete a progress entry (that operation exists but is not yours).
