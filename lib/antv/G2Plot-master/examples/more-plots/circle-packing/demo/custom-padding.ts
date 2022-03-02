import { CirclePacking } from '@antv/g2plot';
fetch('https://gw.alipayobjects.com/os/antfincdn/%24m0nDoQYqH/basic-packing.json')
  .then((data) => data.json())
  .then((data) => {
    const plot = new CirclePacking('container', {
      autoFit: true,
      padding: 0,
      data,
      hierarchyConfig: {
        padding: 0.01,
      },
      color: 'rgb(252, 253, 191)-rgb(231, 82, 99)-rgb(183, 55, 121)',
      // 自定义 label 样式
      label: false,
      legend: false,
    });

    plot.render();
  });
