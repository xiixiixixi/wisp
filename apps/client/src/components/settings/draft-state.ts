export interface SettingsDraftState {
  dirty: boolean;
  busy: boolean;
}

export interface SettingsEditorProps {
  onDraftChange?: (state: SettingsDraftState) => void;
}
