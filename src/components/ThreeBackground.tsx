"use client";

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function ThreeBackground() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;

        // Scene Setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xffffff); // White background

        // Camera
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.y = 80;
        camera.position.z = 100;
        camera.lookAt(0, 0, 0);

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        mountRef.current.appendChild(renderer.domElement);

        // Particles Data
        const count = 100 * 100; // 10k particles
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const originalY = new Float32Array(count); // Store original Y for wave calc

        // Creating a grid of particles
        let idx = 0;
        const separation = 3;
        const offset = (100 * separation) / 2;

        const colorInside = new THREE.Color('#3b82f6'); // Blue
        const colorOutside = new THREE.Color('#8b5cf6'); // Purple

        for (let x = 0; x < 100; x++) {
            for (let z = 0; z < 100; z++) {
                const px = (x * separation) - offset;
                const pz = (z * separation) - offset;
                const py = 0;

                positions[idx * 3] = px;
                positions[idx * 3 + 1] = py;
                positions[idx * 3 + 2] = pz;
                originalY[idx] = py;

                // Gradient Color based on position
                const mixedColor = colorInside.clone().lerp(colorOutside, Math.abs(px) / offset);
                colors[idx * 3] = mixedColor.r;
                colors[idx * 3 + 1] = mixedColor.g;
                colors[idx * 3 + 2] = mixedColor.b;

                idx++;
            }
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Custom Shader Material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uMouse: { value: new THREE.Vector2(0, 0) },
                uHoverActive: { value: 0 }
            },
            vertexShader: `
        uniform float uTime;
        uniform vec2 uMouse;
        uniform float uHoverActive;
        
        varying vec3 vColor;

        void main() {
          vColor = color;
          vec3 pos = position;

          // Idle Wave
          float wave = sin(pos.x * 0.05 + uTime) * cos(pos.z * 0.05 + uTime) * 2.0;
          pos.y += wave;

          // Mouse Interaction (Anti-Gravity Lift)
          // Convert world position to normalized device coordinates roughly to match mouse
          // For simplicity in this grid, we map mouse directly to world coords range
          float dist = distance(pos.xz, uMouse * 150.0); // Simple mapping
          float radius = 40.0;
          
          if (dist < radius) {
            float force = (radius - dist) / radius;
            // Lift up (Y) and push out slightly
            pos.y += force * 30.0 * uHoverActive; 
          }

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = 3.0 * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
            fragmentShader: `
        varying vec3 vColor;
        
        void main() {
          float r = distance(gl_PointCoord, vec2(0.5));
          if (r > 0.5) discard;
          
          gl_FragColor = vec4(vColor, 1.0); // opacity
        }
      `,
            transparent: true,
            vertexColors: true,
        });

        const particlesSystem = new THREE.Points(geometry, material);
        scene.add(particlesSystem);

        // Mouse Handler
        let mouseX = 0;
        let mouseY = 0;

        const onMouseMove = (event: MouseEvent) => {
            // Normalize mouse to -1 to 1
            mouseX = (event.clientX / window.innerWidth) * 2 - 1;
            mouseY = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update Uniforms
            // We flip Y for 3D space logic if needed, but here we just pass raw normalized
            // Note: The shader mapping above (uMouse * 150.0) assumes the grid covers approx -150 to 150 space visible
            material.uniforms.uMouse.value.set(mouseX, mouseY);
            material.uniforms.uHoverActive.value = 1;
        };

        window.addEventListener('mousemove', onMouseMove);

        // Animation Loop
        const animate = () => {
            material.uniforms.uTime.value += 0.02;

            // Gentle camera sway
            // camera.position.x += (mouseX * 10 - camera.position.x) * 0.05;
            // camera.position.y += (-mouseY * 10 + 80 - camera.position.y) * 0.05;
            camera.lookAt(0, 0, 0);

            renderer.render(scene, camera);
            requestAnimationFrame(animate);
        };

        animate();

        // Resize
        const handleResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('resize', handleResize);
            if (mountRef.current) {
                mountRef.current.removeChild(renderer.domElement);
            }
            geometry.dispose();
            material.dispose();
        };
    }, []);

    return <div ref={mountRef} className="fixed inset-0 pointer-events-none z-0" />;
}
