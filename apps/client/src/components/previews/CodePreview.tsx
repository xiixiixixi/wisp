import { PreviewProps } from '@/lib/preview-factory';
import CodeMirrorPreview from './CodeMirrorPreview';

/** Code files: CodeMirror 6 preview + edit, AI actions attached. */
const CodePreview = (props: PreviewProps) => <CodeMirrorPreview {...props} showAiActions />;

export default CodePreview;
