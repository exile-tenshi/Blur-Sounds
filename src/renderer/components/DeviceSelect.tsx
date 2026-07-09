import type { AudioDevice } from '../../shared/audioTypes'
import { formatDeviceOptionLabel, type DeviceGroup } from '../../shared/deviceGroups'

interface DeviceSelectProps {
  value: string
  groups: DeviceGroup[]
  placeholder: string
  disabled?: boolean
  onChange: (deviceId: string) => void
}

export function DeviceSelect({ value, groups, placeholder, disabled, onChange }: DeviceSelectProps) {
  const totalCount = groups.reduce((count, group) => count + group.devices.length, 0)

  return (
    <select value={value} disabled={disabled || totalCount === 0} onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled>
        {totalCount === 0 ? 'No devices found — click Refresh' : placeholder}
      </option>
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.devices.map((device) => (
            <option key={device.id} value={device.id} disabled={!device.isAvailable}>
              {formatDeviceOptionLabel(device)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function countDevices(groups: DeviceGroup[]): number {
  return groups.reduce((count, group) => count + group.devices.length, 0)
}

export function findDevice(groups: DeviceGroup[], deviceId?: string): AudioDevice | undefined {
  if (!deviceId) {
    return undefined
  }

  for (const group of groups) {
    const device = group.devices.find((entry) => entry.id === deviceId)
    if (device) {
      return device
    }
  }

  return undefined
}
