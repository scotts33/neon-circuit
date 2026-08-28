/**
 * Ultra post-FX pipeline: multi-pass bloom, SSAO, color grade.
 * Designed to keep the GPU busy on high-DPI macOS (Metal/WebGL).
 * Requires THREE.
 */
(function (root) {
  "use strict";

  function makeRT(THREE, w, h, withDepth) {
    var pars = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: !!withDepth,
      stencilBuffer: false,
    };
    var rt = new THREE.WebGLRenderTarget(w, h, pars);
    if (withDepth && THREE.DepthTexture) {
      rt.depthTexture = new THREE.DepthTexture(w, h);
      if (THREE.UnsignedIntType) rt.depthTexture.type = THREE.UnsignedIntType;
      else rt.depthTexture.type = THREE.UnsignedShortType;
    }
    return rt;
  }

  function createUltraPipeline(renderer, width, height, opts) {
    var THREE = root.THREE;
    if (!THREE || !renderer) return null;
    opts = opts || {};
    var bloomPasses = opts.bloomPasses != null ? opts.bloomPasses : 3;
    var enableSSAO = opts.ssao !== false;
    var enableMotion = opts.motionBlur !== false;
    var enableAutoExp = opts.autoExposure !== false;

    var fullW = Math.max(2, width | 0);
    var fullH = Math.max(2, height | 0);
    var halfW = Math.max(2, Math.floor(fullW / 2));
    var halfH = Math.max(2, Math.floor(fullH / 2));

    var sceneRT = makeRT(THREE, fullW, fullH, true);
    var brightRT = makeRT(THREE, halfW, halfH, false);
    var blurRTA = makeRT(THREE, halfW, halfH, false);
    var blurRTB = makeRT(THREE, halfW, halfH, false);
    var ssaoRT = makeRT(THREE, halfW, halfH, false);

    var brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: 0.68 },
        intensity: { value: 0.9 },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; uniform float threshold; uniform float intensity; varying vec2 vUv;" +
        "void main(){ vec4 c=texture2D(tDiffuse,vUv); float b=dot(c.rgb,vec3(0.2126,0.7152,0.0722));" +
        "float k=smoothstep(threshold,threshold+0.22,b); gl_FragColor=vec4(c.rgb*k*intensity,1.0); }",
      depthTest: false,
      depthWrite: false,
    });

    var blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        direction: { value: new THREE.Vector2(1, 0) },
        resolution: { value: new THREE.Vector2(halfW, halfH) },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; uniform vec2 direction; uniform vec2 resolution; varying vec2 vUv;" +
        "void main(){ vec2 px=direction/resolution; vec4 s=vec4(0.0);" +
        "s+=texture2D(tDiffuse,vUv-px*6.0)*0.03;" +
        "s+=texture2D(tDiffuse,vUv-px*5.0)*0.05;" +
        "s+=texture2D(tDiffuse,vUv-px*4.0)*0.07;" +
        "s+=texture2D(tDiffuse,vUv-px*3.0)*0.10;" +
        "s+=texture2D(tDiffuse,vUv-px*2.0)*0.13;" +
        "s+=texture2D(tDiffuse,vUv-px)*0.15;" +
        "s+=texture2D(tDiffuse,vUv)*0.16;" +
        "s+=texture2D(tDiffuse,vUv+px)*0.15;" +
        "s+=texture2D(tDiffuse,vUv+px*2.0)*0.13;" +
        "s+=texture2D(tDiffuse,vUv+px*3.0)*0.10;" +
        "s+=texture2D(tDiffuse,vUv+px*4.0)*0.07;" +
        "s+=texture2D(tDiffuse,vUv+px*5.0)*0.05;" +
        "s+=texture2D(tDiffuse,vUv+px*6.0)*0.03;" +
        "gl_FragColor=s; }",
      depthTest: false,
      depthWrite: false,
    });

    var ssaoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(halfW, halfH) },
        strength: { value: 0.55 },
        radius: { value: 1.8 },
        cameraNear: { value: 0.4 },
        cameraFar: { value: 2500 },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader:
        "uniform sampler2D tDepth; uniform sampler2D tDiffuse; uniform vec2 resolution;" +
        "uniform float strength; uniform float radius; uniform float cameraNear; uniform float cameraFar;" +
        "varying vec2 vUv;" +
        "float linearize(float d){ float z=d*2.0-1.0; return (2.0*cameraNear*cameraFar)/(cameraFar+cameraNear-z*(cameraFar-cameraNear)); }" +
        "void main(){" +
        "float depth=texture2D(tDepth,vUv).x;" +
        "float z=linearize(depth);" +
        "vec2 px=radius/resolution;" +
        "float occ=0.0;" +
        "const int N=16;" +
        "for(int i=0;i<N;i++){" +
        "float fi=float(i);" +
        "float a=fi*2.399963;" +
        "float r=(fi+1.0)/float(N);" +
        "vec2 o=vec2(cos(a),sin(a))*px*r*12.0;" +
        "float zd=linearize(texture2D(tDepth,vUv+o).x);" +
        "float diff=z-zd;" +
        "occ+=clamp(diff*0.35,0.0,1.0)*smoothstep(8.0,0.0,abs(diff));" +
        "}" +
        "occ=1.0-(occ/float(N))*strength;" +
        "vec3 col=texture2D(tDiffuse,vUv).rgb*mix(0.55,1.0,occ);" +
        "gl_FragColor=vec4(col,1.0);" +
        "}",
      depthTest: false,
      depthWrite: false,
    });

    var compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tSSAO: { value: null },
        useSSAO: { value: enableSSAO ? 1 : 0 },
        bloomStrength: { value: 0.48 },
        vignette: { value: 0.16 },
        saturation: { value: 1.18 },
        exposure: { value: 1.2 },
        lift: { value: 0.03 },
        sharpness: { value: 0.2 },
        speedFrac: { value: 0 },
        boost: { value: 0 },
        motionBlur: { value: enableMotion ? 1 : 0 },
        chromatic: { value: 0 },
        resolution: { value: new THREE.Vector2(fullW, fullH) },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader:
        "uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tSSAO;" +
        "uniform float useSSAO; uniform float bloomStrength; uniform float vignette;" +
        "uniform float saturation; uniform float exposure; uniform float lift; uniform float sharpness;" +
        "uniform float speedFrac; uniform float boost; uniform float motionBlur; uniform float chromatic;" +
        "uniform vec2 resolution; varying vec2 vUv;" +
        "vec3 ACESFilm(vec3 x){ const float a=2.51; const float b=0.03; const float c=2.43; const float d=0.59; const float e=0.14;" +
        "return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }" +
        "void main(){" +
        "vec2 uv=vUv;" +
        "vec2 center=vec2(0.5);" +
        "vec2 dir=uv-center;" +
        "float mb=motionBlur*speedFrac*(0.55+boost*0.65);" +
        "vec3 scene=vec3(0.0);" +
        "if(mb>0.02){" +
        "const int S=5; float wsum=0.0;" +
        "for(int i=0;i<S;i++){" +
        "float t=(float(i)/float(S-1)-0.5)*mb*0.028;" +
        "vec2 suv=uv+dir*t;" +
        "float w=1.0-abs(t)*12.0; w=max(w,0.05);" +
        "scene+=texture2D(tScene,suv).rgb*w; wsum+=w;" +
        "}" +
        "scene/=wsum;" +
        "} else { scene=texture2D(tScene,uv).rgb; }" +
        "if(useSSAO>0.5){ scene=mix(scene,texture2D(tSSAO,uv).rgb,0.85); }" +
        "float ca=chromatic*(0.0012+boost*0.0025+speedFrac*0.0008);" +
        "if(ca>0.0001){" +
        "float r=texture2D(tScene,uv+dir*ca).r;" +
        "float b=texture2D(tScene,uv-dir*ca).b;" +
        "scene.r=mix(scene.r,r,0.65); scene.b=mix(scene.b,b,0.65);" +
        "}" +
        "vec2 px=1.0/resolution;" +
        "vec3 blur=texture2D(tScene,uv+px).rgb+texture2D(tScene,uv-px).rgb+" +
        "texture2D(tScene,uv+vec2(px.x,-px.y)).rgb+texture2D(tScene,uv+vec2(-px.x,px.y)).rgb;" +
        "blur*=0.25;" +
        "scene=mix(scene,scene+(scene-blur),sharpness);" +
        "vec3 bloom=texture2D(tBloom,uv).rgb;" +
        "vec3 col=(scene+bloom*bloomStrength*(1.0+boost*0.15))*exposure+vec3(lift);" +
        "float l=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(l),col,saturation);" +
        "col.r*=1.02; col.b*=0.99;" +
        "col=ACESFilm(col);" +
        "float d=distance(uv,center); float vig=smoothstep(1.15,0.45,d);" +
        "col*=mix(1.0,vig,vignette+speedFrac*0.06);" +
        "gl_FragColor=vec4(col,1.0);" +
        "}",
      depthTest: false,
      depthWrite: false,
    });

    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightMat);
    var fsScene = new THREE.Scene();
    fsScene.add(quad);
    var fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    function blit(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(fsScene, fsCam);
    }

    return {
      enabled: true,
      ssao: enableSSAO,
      bloomPasses: bloomPasses,
      motionBlur: enableMotion,
      autoExposure: enableAutoExp,
      sceneRT: sceneRT,
      setSize: function (fw, fh) {
        fullW = Math.max(2, fw | 0);
        fullH = Math.max(2, fh | 0);
        halfW = Math.max(2, Math.floor(fullW / 2));
        halfH = Math.max(2, Math.floor(fullH / 2));
        sceneRT.setSize(fullW, fullH);
        if (sceneRT.depthTexture) {
          sceneRT.depthTexture.image.width = fullW;
          sceneRT.depthTexture.image.height = fullH;
          sceneRT.depthTexture.needsUpdate = true;
        }
        brightRT.setSize(halfW, halfH);
        blurRTA.setSize(halfW, halfH);
        blurRTB.setSize(halfW, halfH);
        ssaoRT.setSize(halfW, halfH);
        blurMat.uniforms.resolution.value.set(halfW, halfH);
        ssaoMat.uniforms.resolution.value.set(halfW, halfH);
        compMat.uniforms.resolution.value.set(fullW, fullH);
      },
      render: function (renderer, scene3, camera) {
        if (!this.enabled || !this.sceneRT) return false;
        var prev = renderer.getRenderTarget();
        var prevTM = renderer.toneMapping;
        var prevExp = renderer.toneMappingExposure;
        if (THREE.NoToneMapping !== undefined) renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1.0;

        renderer.setRenderTarget(this.sceneRT);
        renderer.clear();
        renderer.render(scene3, camera);

        brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
        blit(brightMat, brightRT);

        var readRT = brightRT;
        var writeRT = blurRTA;
        var p;
        for (p = 0; p < this.bloomPasses; p++) {
          blurMat.uniforms.tDiffuse.value = readRT.texture;
          blurMat.uniforms.direction.value.set(1.0 + p * 0.35, 0);
          blit(blurMat, writeRT);
          blurMat.uniforms.tDiffuse.value = writeRT.texture;
          blurMat.uniforms.direction.value.set(0, 1.0 + p * 0.35);
          if (writeRT === blurRTA) {
            blit(blurMat, blurRTB);
            readRT = blurRTB;
            writeRT = blurRTA;
          } else {
            blit(blurMat, blurRTA);
            readRT = blurRTA;
            writeRT = blurRTB;
          }
        }
        var bloomTex = readRT.texture;

        if (this.ssao && this.sceneRT.depthTexture) {
          ssaoMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
          ssaoMat.uniforms.tDiffuse.value = this.sceneRT.texture;
          ssaoMat.uniforms.cameraNear.value = camera.near;
          ssaoMat.uniforms.cameraFar.value = camera.far;
          blit(ssaoMat, ssaoRT);
          compMat.uniforms.tSSAO.value = ssaoRT.texture;
          compMat.uniforms.useSSAO.value = 1;
        } else {
          compMat.uniforms.useSSAO.value = 0;
        }

        compMat.uniforms.tScene.value = this.sceneRT.texture;
        compMat.uniforms.tBloom.value = bloomTex;
        blit(compMat, null);

        renderer.toneMapping = prevTM;
        renderer.toneMappingExposure = prevExp;
        renderer.setRenderTarget(prev);
        return true;
      },
      setDynamics: function (dyn) {
        dyn = dyn || {};
        if (dyn.speedFrac != null) {
          compMat.uniforms.speedFrac.value = Math.max(
            0,
            Math.min(1, dyn.speedFrac)
          );
        }
        if (dyn.boosting != null) {
          compMat.uniforms.boost.value = dyn.boosting ? 1 : 0;
          compMat.uniforms.chromatic.value = dyn.boosting ? 1 : 0.35;
        }
        if (dyn.haze != null) {
          var h = Math.max(0, Math.min(1, dyn.haze));
          compMat.uniforms.boost.value = Math.max(
            compMat.uniforms.boost.value,
            h
          );
          compMat.uniforms.chromatic.value = Math.max(
            compMat.uniforms.chromatic.value,
            0.35 + h * 0.85
          );
          if (h > 0.2) {
            compMat.uniforms.speedFrac.value = Math.max(
              compMat.uniforms.speedFrac.value,
              0.35 + h * 0.5
            );
          }
        }
        if (dyn.rain != null && dyn.rain) {
          compMat.uniforms.speedFrac.value = Math.min(
            1,
            compMat.uniforms.speedFrac.value + 0.08
          );
        }
        if (dyn.exposure != null && enableAutoExp) {
          compMat.uniforms.exposure.value = dyn.exposure;
        }
      },
      dispose: function () {
        sceneRT.dispose();
        brightRT.dispose();
        blurRTA.dispose();
        blurRTB.dispose();
        ssaoRT.dispose();
        brightMat.dispose();
        blurMat.dispose();
        ssaoMat.dispose();
        compMat.dispose();
      },
    };
  }

  function createBloomPipeline(renderer, width, height) {
    return createUltraPipeline(renderer, width, height, { ssao: true, bloomPasses: 2 });
  }

  function createParticlePool(THREE, count, color, size) {
    var positions = new Float32Array(count * 3);
    var velocities = new Float32Array(count * 3);
    var life = new Float32Array(count);
    var i;
    for (i = 0; i < count; i++) {
      life[i] = 0;
      positions[i * 3 + 1] = -999;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage || 35048);
    var mat = new THREE.PointsMaterial({
      color: color,
      size: size || 1.4,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData = {
      positions: positions,
      velocities: velocities,
      life: life,
      count: count,
      emit: function (x, y, z, vx, vy, vz, n) {
        var emitted = 0;
        var j;
        for (j = 0; j < count && emitted < n; j++) {
          if (life[j] <= 0) {
            positions[j * 3] = x + (Math.random() - 0.5) * 1.5;
            positions[j * 3 + 1] = y + Math.random() * 0.5;
            positions[j * 3 + 2] = z + (Math.random() - 0.5) * 1.5;
            velocities[j * 3] = vx + (Math.random() - 0.5) * 8;
            velocities[j * 3 + 1] = vy + Math.random() * 6;
            velocities[j * 3 + 2] = vz + (Math.random() - 0.5) * 8;
            life[j] = 0.35 + Math.random() * 0.55;
            emitted++;
          }
        }
      },
      step: function (dt) {
        var j;
        for (j = 0; j < count; j++) {
          if (life[j] <= 0) continue;
          life[j] -= dt;
          positions[j * 3] += velocities[j * 3] * dt;
          positions[j * 3 + 1] += velocities[j * 3 + 1] * dt;
          positions[j * 3 + 2] += velocities[j * 3 + 2] * dt;
          velocities[j * 3 + 1] -= 12 * dt;
          if (life[j] <= 0) positions[j * 3 + 1] = -999;
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
    return pts;
  }

  function createSkidSystem(THREE, opts) {
    opts = opts || {};
    var group = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    var max = opts.max != null ? opts.max : 280;
    var pool = [];
    var i;
    for (i = 0; i < max; i++) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.62), mat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.userData.life = 0;
      group.add(m);
      pool.push(m);
    }
    var cursor = 0;
    group.userData.stamp = function (x, z, angle, strength, elev, dense) {
      if (strength < 0.22) return;
      elev = elev != null ? elev : 0.09;
      var marks = dense && strength > 0.45 ? 2 : 1;
      var mi;
      for (mi = 0; mi < marks; mi++) {
        var m = pool[cursor % max];
        cursor++;
        var side = marks > 1 ? (mi === 0 ? -1.1 : 1.1) : 0;
        var rx = -Math.sin(angle) * side;
        var rz = Math.cos(angle) * side;
        m.visible = true;
        m.position.set(x + rx, elev + 0.05, z + rz);
        m.rotation.y = -angle;
        m.userData.life = 5 + Math.random() * 4 + strength * 2;
        m.material.opacity = 0.28 + Math.min(0.5, strength * 0.42);
        m.scale.set(1 + strength * 0.45, 1, 1 + strength * 0.15);
      }
    };
    group.userData.step = function (dt) {
      var j, m;
      for (j = 0; j < max; j++) {
        m = pool[j];
        if (!m.visible) continue;
        m.userData.life -= dt;
        if (m.userData.life <= 0) m.visible = false;
        else m.material.opacity = Math.min(m.material.opacity, m.userData.life * 0.08);
      }
    };
    return group;
  }

  var api = {
    createBloomPipeline: createBloomPipeline,
    createUltraPipeline: createUltraPipeline,
    createParticlePool: createParticlePool,
    createSkidSystem: createSkidSystem,
  };

  root.NeoKartFX = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
