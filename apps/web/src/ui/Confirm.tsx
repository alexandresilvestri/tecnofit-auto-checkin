import { Button } from "./Button";
import { Dialog } from "./Dialog";

export function Confirm({
  open,
  title,
  text,
  action,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <p className="mb-6 text-sm/5 text-fg">{text}</p>
      <div className="flex gap-2">
        <Button onClick={onConfirm}>{action}</Button>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      </div>
    </Dialog>
  );
}
