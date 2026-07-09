const VOICEMEETER_BUS_PATTERN = /voicemeeter (?:in|out) ([ab]\d+)/i

const VOICEMEETER_NUMERIC_IN_PATTERN = /voicemeeter in (\d+)/i



function extractVoicemeeterBusId(deviceName: string): string | undefined {

  const explicit = deviceName.match(VOICEMEETER_BUS_PATTERN)

  if (explicit) {

    return explicit[1].toUpperCase()

  }



  const numeric = deviceName.match(VOICEMEETER_NUMERIC_IN_PATTERN)

  if (numeric) {

    return `A${numeric[1]}`

  }



  return undefined

}



export function isVoicemeeterInputDevice(name: string): boolean {

  return /voicemeeter (input|aux input|vaio3 input|in [ab]?\d)/i.test(name)

}



function getVoicemeeterMatrixRouteLabel(inputName: string): string | undefined {

  const busId = extractVoicemeeterBusId(inputName)

  if (busId) {

    return busId

  }



  if (/voicemeeter input/i.test(inputName) && !/voicemeeter in/i.test(inputName)) {

    return 'A1'

  }



  if (/voicemeeter aux input/i.test(inputName)) {

    return 'AUX'

  }



  return undefined

}



export function getVoicemeeterRoutingSteps(inputName: string, recordingName: string): string[] {

  const routeLabel = getVoicemeeterMatrixRouteLabel(inputName)



  if (routeLabel) {

    return [

      'Audio is reaching the Input — check Windows Sound → Playback for signal on that device.',

      'The app will try to enable the matching Voicemeeter bus automatically when you start the stream.',

      `If Recording is still silent, open Voicemeeter and enable ${routeLabel} on the matching input strip.`,

      `In other apps, select ${recordingName} under Windows Sound → Recording.`,

    ]

  }



  return [`In other apps, select ${recordingName} under Windows Sound → Recording.`]

}

