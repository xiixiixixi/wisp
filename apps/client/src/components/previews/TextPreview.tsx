import { PreviewProps } from '@/lib/preview-factory';
import CodeMirrorPreview from './CodeMirrorPreview';

/** Plain text files: CodeMirror 6 preview + edit (no syntax grammar by default). */
const TextPreview = (props: PreviewProps) => <CodeMirrorPreview {...props} />;

export default TextPreview;
