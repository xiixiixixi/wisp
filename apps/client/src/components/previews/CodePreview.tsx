import { PreviewProps } from '@/lib/preview-factory';
import CodeMirrorPreview from './CodeMirrorPreview';

/** Code files: CodeMirror 6 preview and editing. */
const CodePreview = (props: PreviewProps) => <CodeMirrorPreview {...props} />;

export default CodePreview;
