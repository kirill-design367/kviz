'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Наклон карточки за указателем.
 *
 * Работает только там, где есть настоящая мышь: на телефоне наклонять нечем,
 * а лишний слушатель и цикл кадров там стоят батареи и кадров. Значения
 * пишутся в CSS-переменные, а не в style.transform целиком — так карточка
 * остаётся под управлением одного правила в таблице стилей, и её собственные
 * переходы не дерутся с покадровым обновлением.
 *
 * Между целью и текущим положением стоит сглаживание: указатель прыгает,
 * карточка догоняет. Цикл кадров живёт только пока курсор над карточкой.
 */
export function usePointerTilt(
  ref: RefObject<HTMLElement | null>,
  { max = 6, enabled = true }: { max?: number; enabled?: boolean } = {},
) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let running = false;
    // Габариты карточки читаются один раз на входе указателя и по изменению
    // размера окна. Читать getBoundingClientRect на каждом движении значит
    // заставлять браузер пересчитывать раскладку десятки раз в секунду.
    let rect: DOMRect | null = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const apply = () => {
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      node.style.setProperty('--rx', `${currentX.toFixed(3)}deg`);
      node.style.setProperty('--ry', `${currentY.toFixed(3)}deg`);

      const settled = Math.abs(targetX - currentX) < 0.01 && Math.abs(targetY - currentY) < 0.01;
      if (settled && targetX === 0 && targetY === 0) {
        // Вернулись в исходное — цикл кадров больше не нужен.
        running = false;
        node.dataset.tracking = '0';
        node.style.removeProperty('--rx');
        node.style.removeProperty('--ry');
        return;
      }
      raf = requestAnimationFrame(apply);
    };

    const start = () => {
      if (running) return;
      running = true;
      node.dataset.tracking = '1';
      raf = requestAnimationFrame(apply);
    };

    const measure = () => {
      rect = node.getBoundingClientRect();
    };

    const onEnter = () => measure();

    const onMove = (event: PointerEvent) => {
      if (!rect) measure();
      if (!rect || !rect.width || !rect.height) return;
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      // Вертикаль указателя вращает вокруг X, горизонталь — вокруг Y.
      targetX = -py * max * 2;
      targetY = px * max * 2;
      start();
    };

    const onLeave = () => {
      rect = null;
      targetX = 0;
      targetY = 0;
      start();
    };

    node.addEventListener('pointerenter', onEnter);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    node.addEventListener('pointercancel', onLeave);
    window.addEventListener('resize', measure, { passive: true });

    return () => {
      node.removeEventListener('pointerenter', onEnter);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      node.removeEventListener('pointercancel', onLeave);
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(raf);
      node.dataset.tracking = '0';
      node.style.removeProperty('--rx');
      node.style.removeProperty('--ry');
    };
  }, [ref, max, enabled]);
}
