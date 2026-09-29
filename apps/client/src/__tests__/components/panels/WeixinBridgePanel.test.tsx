import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WeixinBridgePanel from '@/components/panels/WeixinBridgePanel';
import { weixinBridge } from '@/lib/weixin/bridge';
const fixture = vi.hoisted(() => ({
  folders: ['/work'],
  replyOn: 'step',
  noticeTools: true,
  desktop: true,
}));
vi.mock('@/lib/transport', () => ({ isTauri: () => fixture.desktop }));
vi.mock('@/lib/weixin/bridge', () => ({
  weixinBridge: {
    state: { status: 'connected', botId: 'test' },
    subscribe: vi.fn(() => () => {}),
    init: vi.fn(async () => {}),
    getLogs: () => [],
    getPersisted: () => fixture,
    setPersisted: vi.fn(async () => {}),
    unbind: vi.fn(async () => {}),
    beginPairing: vi.fn(async () => {}),
    submitVerifyCode: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.folders = ['/work'];
  fixture.desktop = true;
  weixinBridge.state.status = 'connected';
  weixinBridge.state.qrUrl = undefined;
  vi.mocked(weixinBridge.setPersisted).mockResolvedValue(undefined);
});
describe('Weixin folder controls', () => {
  it('explains desktop pairing in the browser without showing a fake QR wait or unsaved settings', () => {
    fixture.desktop = false;
    weixinBridge.state.status = 'idle';
    render(<WeixinBridgePanel currentPath="/work" />);
    expect(
      screen.getByText('Open the desktop app and scan the QR code to pair WeChat.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Generating QR code…')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose a folder/ })).not.toBeInTheDocument();
    expect(weixinBridge.beginPairing).not.toHaveBeenCalled();
  });
  it('keeps QR refresh and phone verification available on desktop', () => {
    weixinBridge.state.status = 'need-code';
    weixinBridge.state.qrUrl = 'data:image/png;base64,AAAA';
    render(<WeixinBridgePanel currentPath="/work" />);
    expect(screen.getByRole('img', { name: 'Pairing QR code' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh QR code' }));
    expect(weixinBridge.beginPairing).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByTestId('weixin-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(weixinBridge.submitVerifyCode).toHaveBeenCalledWith('123456');
  });
  it('does not allow removing the last restricted working folder accidentally', () => {
    render(<WeixinBridgePanel currentPath="/work" />);
    expect(screen.getByRole('button', { name: 'Remove /work from the list' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow any working folder…' }));
    expect(weixinBridge.setPersisted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This removes the current folder list restriction',
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(weixinBridge.setPersisted).not.toHaveBeenCalled();
  });
  it('applies an unrestricted folder choice only after explicit confirmation', async () => {
    render(<WeixinBridgePanel currentPath="/work" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow any working folder…' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Allow any working folder…' }),
    );
    await waitFor(() => expect(weixinBridge.setPersisted).toHaveBeenCalledWith({ folders: [] }));
  });
  it('shows failed settings writes and keeps the previous folder list', async () => {
    vi.mocked(weixinBridge.setPersisted).mockRejectedValue(new Error('Disk full'));
    render(<WeixinBridgePanel currentPath="/other" />);
    fireEvent.click(screen.getByRole('button', { name: /Current folder/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Settings were not saved. Try again. Error: Disk full',
      ),
    );
    expect(screen.getByText('/work')).toBeInTheDocument();
  });
});
