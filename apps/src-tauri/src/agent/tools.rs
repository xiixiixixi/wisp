/// Returns true if a tool requires user approval before execution.
/// Mirrored on the frontend by pi-engine/tools.ts WRITE_TOOLS.
pub fn tool_requires_approval(name: &str) -> bool {
    matches!(
        name,
        "write_file"
            | "create_directory"
            | "rename"
            | "delete"
            | "move_file"
            | "copy_file"
            | "execute_command"
            | "execute_plan"
    )
}
