import { DropdownMenu } from 'radix-ui'
import { useT } from '../i18n'
import { MoreIcon, TrashIcon } from '../icons'

interface Props {
  /** The delete item's label, which names what it removes. */
  label: string
  disabled: boolean
  onSelect: () => void
}

/** The More menu on a discussion's message, live or resolved, offering its one delete action. */
export function DiscussionMenu({ label, disabled, onSelect }: Props) {
  const t = useT()
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild><button type="button" className="btn-ghost btn-icon rail-icon"
      aria-label={t('moreActions')} title={t('moreActions')}><MoreIcon /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content data-keeps-discussion="" className="reader-menu" align="end" sideOffset={4}>
        <DropdownMenu.Item className="reader-menu-item" disabled={disabled} onSelect={() => { if (!disabled) onSelect() }}>
          <TrashIcon />{label}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
