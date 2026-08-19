import type { ColorGrade } from '../../shared/videoStudio'
import type { CubeLut } from './cubeLut'

// GPU-accelerated preview compositor (WebGL2). Renders a video frame through a
// color-grade fragment shader (exposure / lift-gamma-gain / contrast / saturation /
// temperature-tint) with an optional 3D LUT sampled from a sampler3D.

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = vec2((aPosition.x + 1.0) * 0.5, 1.0 - (aPosition.y + 1.0) * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFrame;
uniform sampler3D uLut;
uniform bool uHasLut;
uniform float uLutIntensity;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uLift;
uniform float uGamma;
uniform float uGain;

void main() {
  vec3 c = texture(uFrame, vUv).rgb;

  // Exposure in stops.
  c *= exp2(uExposure);

  // Temperature (warm/cool) and tint (green/magenta).
  c.r *= 1.0 + uTemperature * 0.2;
  c.b *= 1.0 - uTemperature * 0.2;
  c.g *= 1.0 + uTint * 0.15;

  // Lift (shadows), gain (highlights), gamma (midtones) — ASC-CDL style.
  c = c + uLift * (1.0 - c);
  c = c * uGain;
  c = pow(max(c, 0.0), vec3(1.0 / max(uGamma, 0.01)));

  // Contrast around mid-grey.
  c = (c - 0.5) * uContrast + 0.5;

  // Saturation around luma.
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);

  c = clamp(c, 0.0, 1.0);

  if (uHasLut) {
    vec3 graded = texture(uLut, c).rgb;
    c = mix(c, graded, uLutIntensity);
  }

  fragColor = vec4(c, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Unable to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return shader
}

export class PreviewRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly frameTexture: WebGLTexture
  private lutTexture: WebGLTexture | null = null
  private lutSize = 0
  private readonly uniforms: Record<string, WebGLUniformLocation | null>

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    if (!gl) {
      throw new Error('WebGL2 is not available for the preview canvas.')
    }
    this.gl = gl

    const program = gl.createProgram()
    if (!program) {
      throw new Error('Unable to create WebGL program')
    }
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    this.program = program
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )
    const positionLocation = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    const frameTexture = gl.createTexture()
    if (!frameTexture) {
      throw new Error('Unable to create frame texture')
    }
    this.frameTexture = frameTexture
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.uniforms = {
      uFrame: gl.getUniformLocation(program, 'uFrame'),
      uLut: gl.getUniformLocation(program, 'uLut'),
      uHasLut: gl.getUniformLocation(program, 'uHasLut'),
      uLutIntensity: gl.getUniformLocation(program, 'uLutIntensity'),
      uExposure: gl.getUniformLocation(program, 'uExposure'),
      uContrast: gl.getUniformLocation(program, 'uContrast'),
      uSaturation: gl.getUniformLocation(program, 'uSaturation'),
      uTemperature: gl.getUniformLocation(program, 'uTemperature'),
      uTint: gl.getUniformLocation(program, 'uTint'),
      uLift: gl.getUniformLocation(program, 'uLift'),
      uGamma: gl.getUniformLocation(program, 'uGamma'),
      uGain: gl.getUniformLocation(program, 'uGain'),
    }

    gl.uniform1i(this.uniforms.uFrame, 0)
    gl.uniform1i(this.uniforms.uLut, 1)
  }

  setLut(lut: CubeLut | null): void {
    const gl = this.gl
    if (!lut) {
      if (this.lutTexture) {
        gl.deleteTexture(this.lutTexture)
        this.lutTexture = null
      }
      this.lutSize = 0
      return
    }

    if (!this.lutTexture) {
      this.lutTexture = gl.createTexture()
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      lut.data,
    )
    this.lutSize = lut.size
  }

  render(source: HTMLVideoElement | HTMLImageElement, grade: ColorGrade, lutIntensity: number): void {
    const gl = this.gl
    const width =
      source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
    const height =
      source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
    if (!width || !height) {
      return
    }

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    gl.useProgram(this.program)
    gl.viewport(0, 0, width, height)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    if (this.lutTexture) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    }

    gl.uniform1i(this.uniforms.uHasLut, this.lutSize > 0 ? 1 : 0)
    gl.uniform1f(this.uniforms.uLutIntensity, lutIntensity)
    gl.uniform1f(this.uniforms.uExposure, grade.exposure)
    gl.uniform1f(this.uniforms.uContrast, grade.contrast)
    gl.uniform1f(this.uniforms.uSaturation, grade.saturation)
    gl.uniform1f(this.uniforms.uTemperature, grade.temperature)
    gl.uniform1f(this.uniforms.uTint, grade.tint)
    gl.uniform1f(this.uniforms.uLift, grade.lift)
    gl.uniform1f(this.uniforms.uGamma, grade.gamma)
    gl.uniform1f(this.uniforms.uGain, grade.gain)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteTexture(this.frameTexture)
    if (this.lutTexture) {
      gl.deleteTexture(this.lutTexture)
    }
    gl.deleteProgram(this.program)
  }
}
