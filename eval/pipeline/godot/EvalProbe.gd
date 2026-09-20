extends Node

## Injected by the eval harness. Builders must not ship this file.

func dump(schema_id: String, schema_sha256: String, keys: PackedStringArray) -> Dictionary:
	var root := get_tree().current_scene
	if root == null:
		return {"ok": false, "code": "BOOT_FAIL"}
	var out := {
		"eval.schema_id": schema_id,
		"eval.schema_sha256": schema_sha256,
	}
	for key in keys:
		out[key] = root.get(key)
	return out
