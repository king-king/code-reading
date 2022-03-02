import { Rose } from '@antv/g2plot';

const data = [
  {
    type: '分类一',
    value: 27,
    user: '用户一',
  },
  {
    type: '分类二',
    value: 25,
    user: '用户一',
  },
  {
    type: '分类三',
    value: 18,
    user: '用户一',
  },
  {
    type: '分类四',
    value: 15,
    user: '用户一',
  },
  {
    type: '分类五',
    value: 10,
    user: '用户一',
  },
  {
    type: '其它',
    value: 5,
    user: '用户一',
  },
  {
    type: '分类一',
    value: 7,
    user: '用户二',
  },
  {
    type: '分类二',
    value: 5,
    user: '用户二',
  },
  {
    type: '分类三',
    value: 38,
    user: '用户二',
  },
  {
    type: '分类四',
    value: 5,
    user: '用户二',
  },
  {
    type: '分类五',
    value: 20,
    user: '用户二',
  },
  {
    type: '其它',
    value: 15,
    user: '用户二',
  },
];

// 堆叠玫瑰图
const rosePlot = new Rose('container', {
  data,
  xField: 'type',
  yField: 'value',
  isStack: true,
  // 当 isStack 为 true 时，该值为必填
  seriesField: 'user',
  radius: 0.9,
  label: {
    offset: -15,
  },
  interactions: [
    {
      type: 'element-active',
    },
  ],
});

rosePlot.render();
