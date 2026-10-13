import { useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { calendarDay, dailySummary, type Activity } from '@water-king/domain';

const storageKey = 'water-king:demo:v1';
export default function Index() {
  const [records, setRecords] = useState<Activity[]>(() => {
    const stored = Taro.getStorageSync(storageKey);
    return Array.isArray(stored) ? stored : [];
  });
  const summary = dailySummary(records, calendarDay(new Date().toISOString()));
  function add(kind: Activity['kind']) {
    const base = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, occurredAt: new Date().toISOString() };
    const next: Activity[] = [...records, kind === 'water' ? { ...base, kind, amountMl: 250 } : { ...base, kind }];
    Taro.setStorageSync(storageKey, next);
    setRecords(next);
  }
  function undo() {
    const next = records.slice(0, -1);
    Taro.setStorageSync(storageKey, next); setRecords(next);
  }
  return <View className='page'>
    <View className='title'>大水之王 💧</View>
    <View className='hint'>本地演示 · 数据仅保存在当前设备，尚未接入账号和云同步</View>
    <View className='card'>
      <Text>今日饮水</Text><View className='value'>{summary.waterMl} ml</View>
      <Button onClick={() => add('water')}>记录一杯水（250 ml）</Button>
    </View>
    <View className='card'>
      <Text>今日如厕：小便 {summary.urinationCount} 次 · 大便 {summary.bowelCount} 次</Text>
      <Button onClick={() => add('urination')}>记录小便</Button>
      <Button onClick={() => add('bowel')}>记录大便</Button>
      <Button disabled={!records.length} onClick={undo}>撤销最近一条</Button>
    </View>
    <View className='card'><Text>排行榜（待接入）</Text>
      <View className='hint'>按记录天数排名，参与前需主动开启。不会展示个人如厕记录。</View>
    </View>
  </View>;
}
