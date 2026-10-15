import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { OnboardingPermissions } from "./OnboardingPermissions";

// Local recording permissions are independent of account authentication.
export function OnboardingController({ requestNonce, ready }: {
 requestNonce: number;
 ready: boolean;
 user: User | null;
 configured: boolean;
 callbackError?: string;
}) {
 const [open, setOpen] = useState(false);
 const close = useCallback(() => {
  saveAppSetting("recordly.onboarding.permissionsRequested", false);
  setOpen(false);
 }, []);
 useEffect(() => {
  if (requestNonce > 0) setOpen(true);
 }, [requestNonce]);
 useEffect(() => {
  if (ready && loadAppSetting<boolean>("recordly.onboarding.permissionsRequested")) setOpen(true);
 }, [ready]);
 useEffect(() => window.electronAPI.onRecordingPermissionsRequested?.(() => setOpen(true)), []);
 const finish = () => {
  close();
  void window.electronAPI.showRecordingHud();
 };
 return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
  <DialogContent aria-label="Recording permissions"><OnboardingPermissions onBack={close} onFinish={finish} /></DialogContent>
 </Dialog>;
}
